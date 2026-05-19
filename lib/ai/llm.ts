/**
 * Unified LLM Call Layer
 *
 * All LLM interactions should go through callLLM / streamLLM.
 */

import { generateText, streamText } from 'ai';
import type { GenerateTextResult, StreamTextResult } from 'ai';
import { createLogger } from '@/lib/logger';
import { PROVIDERS } from './providers';
import { thinkingContext } from './thinking-context';
import { getModelMetadataKey } from './model-metadata';
import { isClaudeCliModel, executeClaudeCli } from './claude-cli';
import type { ThinkingCapability, ThinkingConfig } from '@/lib/types/provider';
import {
  getThinkingMode,
  pickThinkingBudget,
  pickThinkingEffort,
  pickThinkingLevel,
} from '@/lib/ai/thinking-config';
const log = createLogger('LLM');

// Re-export for external use
export type { ThinkingConfig } from '@/lib/types/provider';

// Re-export the parameter types accepted by AI SDK
type GenerateTextParams = Parameters<typeof generateText>[0];
type StreamTextParams = Parameters<typeof streamText>[0];

function _extractRequestInfo(params: GenerateTextParams | StreamTextParams) {
  const tools = params.tools ? Object.keys(params.tools as Record<string, unknown>) : undefined;

  const p = params as Record<string, unknown>;
  return {
    system: p.system as string | undefined,
    prompt: p.prompt as string | undefined,
    messages: p.messages as unknown[] | undefined,
    tools,
    maxOutputTokens: p.maxOutputTokens as number | undefined,
  };
}

function getModelId(params: GenerateTextParams | StreamTextParams): string {
  const m = params.model;
  if (typeof m === 'string') return m;
  if (m && typeof m === 'object' && 'modelId' in m) return (m as { modelId: string }).modelId;
  return 'unknown';
}

// ---------------------------------------------------------------------------
// Thinking / Reasoning Adapter
//
// Builds a lookup table from PROVIDERS at module load time, then uses it to
// map a unified ThinkingConfig into provider-specific providerOptions.
// Native providers (OpenAI/Anthropic/Google) are mapped to providerOptions.
// OpenAI-compatible providers are injected by the providers.ts fetch wrapper.
// ---------------------------------------------------------------------------

interface ModelThinkingInfo {
  thinking?: ThinkingCapability;
}

/** Provider/model → thinking capability (built once at module load) */
const MODEL_THINKING_MAP: Map<string, ModelThinkingInfo> = (() => {
  const map = new Map<string, ModelThinkingInfo>();
  for (const provider of Object.values(PROVIDERS)) {
    for (const model of provider.models) {
      map.set(getModelMetadataKey(provider.id, model.id), {
        thinking: model.capabilities?.thinking,
      });
    }
  }
  return map;
})();

/** Model ID → thinking capability for IDs that are unique across providers. */
const UNIQUE_MODEL_THINKING_MAP: Map<string, ModelThinkingInfo> = (() => {
  const counts = new Map<string, number>();
  for (const provider of Object.values(PROVIDERS)) {
    for (const model of provider.models) {
      counts.set(model.id, (counts.get(model.id) ?? 0) + 1);
    }
  }

  const map = new Map<string, ModelThinkingInfo>();
  for (const provider of Object.values(PROVIDERS)) {
    for (const model of provider.models) {
      if (counts.get(model.id) === 1) {
        map.set(model.id, {
          thinking: model.capabilities?.thinking,
        });
      }
    }
  }
  return map;
})();

/** Global thinking override from environment variable */
function getGlobalThinkingConfig(): ThinkingConfig | undefined {
  if (process.env.LLM_THINKING_DISABLED === 'true') {
    return { mode: 'disabled', enabled: false };
  }
  return undefined;
}

type ProviderOptions = Record<string, Record<string, unknown>>;

function getAnthropicEffort(
  thinking: ThinkingCapability,
  config: ThinkingConfig,
): 'low' | 'medium' | 'high' | 'xhigh' | 'max' | undefined {
  const effort = pickThinkingEffort(thinking, config);
  if (!effort || effort === 'none' || effort === 'minimal') return undefined;
  return effort;
}

function getModelProviderId(params: GenerateTextParams | StreamTextParams): string | undefined {
  const m = params.model;
  if (!m || typeof m !== 'object' || !('provider' in m)) return undefined;
  const provider = (m as { provider?: string }).provider;
  if (!provider) return undefined;
  if (provider in PROVIDERS) return provider;
  const prefix = provider.split('.')[0];
  return prefix in PROVIDERS ? prefix : undefined;
}

/**
 * Map a unified ThinkingConfig to provider-specific providerOptions.
 */
function buildThinkingProviderOptions(
  providerId: string | undefined,
  modelId: string,
  config: ThinkingConfig,
): ProviderOptions | undefined {
  const info = providerId
    ? MODEL_THINKING_MAP.get(getModelMetadataKey(providerId, modelId))
    : UNIQUE_MODEL_THINKING_MAP.get(modelId);
  if (!info?.thinking) return undefined; // model has no thinking capability
  const thinking = info.thinking;
  if (thinking.control === 'none') return undefined;

  const mode = getThinkingMode(config);

  switch (thinking.requestAdapter) {
    case 'openai': {
      const effort = pickThinkingEffort(thinking, config);
      return effort ? { openai: { reasoningEffort: effort } } : undefined;
    }

    case 'anthropic': {
      if (mode === 'disabled') return { anthropic: { thinking: { type: 'disabled' } } };

      if (thinking.control === 'toggle-budget' || thinking.control === 'budget-only') {
        const budget = pickThinkingBudget(thinking, config);
        return budget === undefined
          ? undefined
          : { anthropic: { thinking: { type: 'enabled', budgetTokens: budget } } };
      }

      const effort = getAnthropicEffort(thinking, config);
      if (!effort) return undefined;

      if (thinking.anthropicThinking?.type === 'adaptive') {
        return {
          anthropic: {
            thinking: { type: 'adaptive' },
            effort,
          },
        };
      }

      const manualEffort = effort === 'xhigh' ? 'max' : effort;
      const budget = thinking.anthropicThinking?.budgetByEffort?.[manualEffort];
      if (!budget) return undefined;
      return {
        anthropic: {
          thinking: { type: 'enabled', budgetTokens: budget },
          effort: manualEffort,
        },
      };
    }

    case 'google': {
      if (thinking.control === 'level') {
        const level = pickThinkingLevel(thinking, config);
        return level ? { google: { thinkingConfig: { thinkingLevel: level } } } : undefined;
      }

      const budget = pickThinkingBudget(thinking, config);
      if (budget === undefined) return undefined;
      return { google: { thinkingConfig: { thinkingBudget: budget } } };
    }

    default:
      // OpenAI-compatible providers are injected in providers.ts fetch wrapper.
      return undefined;
  }
}

/**
 * Inject provider-specific thinking options into LLM call params.
 *
 * For native providers (OpenAI/Anthropic/Google), this sets providerOptions.
 * For OpenAI-compatible providers, providerOptions won't work (stripped by
 * zod schema) — those are handled by the custom fetch wrapper via thinkingContext.
 *
 * Priority: caller's providerOptions > ThinkingConfig
 */
function injectProviderOptions<T extends GenerateTextParams | StreamTextParams>(
  params: T,
  thinking?: ThinkingConfig,
): T {
  if ((params as Record<string, unknown>).providerOptions) return params; // caller explicitly set providerOptions

  const modelId = getModelId(params);
  const providerId = getModelProviderId(params);

  if (thinking) {
    const opts = buildThinkingProviderOptions(providerId, modelId, thinking);
    if (opts) return { ...params, providerOptions: opts };
  }

  return params;
}

/**
 * Options for LLM call retry on validation failure.
 * This is separate from the AI SDK's built-in maxRetries (which handles network/5xx errors).
 */
export interface LLMRetryOptions {
  /** Max retry attempts when validate() fails or the response is empty (default: 0 = no retry) */
  retries?: number;
  /** Custom validation function. Return true to accept the result, false to retry.
   *  Default: checks that response text is non-empty. */
  validate?: (text: string) => boolean;
}

const DEFAULT_VALIDATE = (text: string) => text.trim().length > 0;

/**
 * Normalize AI SDK GenerateTextParams into a single (system, user) string pair
 * that the Claude Code CLI can consume. Handles all the common shapes:
 *   { system, prompt }
 *   { system, messages: [{role:'user', content}] }
 *   { messages: [{role:'system'}, {role:'user'}] }
 *   { messages: [{role:'user', content: [{type:'text', text}, ...]}] }
 *
 * Vision parts are skipped (CLI v1 doesn't support image attachments through
 * stdin); only the text portions are concatenated.
 */
function paramsToSystemUser(params: GenerateTextParams): { system: string; user: string } {
  const explicitSystem = typeof params.system === 'string' ? params.system : '';
  const explicitPrompt = typeof params.prompt === 'string' ? params.prompt : '';

  let systemFromMessages = '';
  const userChunks: string[] = [];

  const messages = (params as { messages?: unknown }).messages;
  if (Array.isArray(messages)) {
    for (const msg of messages) {
      if (!msg || typeof msg !== 'object') continue;
      const m = msg as { role?: string; content?: unknown };
      const text = extractText(m.content);
      if (!text) continue;
      if (m.role === 'system') systemFromMessages += (systemFromMessages ? '\n\n' : '') + text;
      else if (m.role === 'user') userChunks.push(text);
      else if (m.role === 'assistant') {
        // Multi-turn isn't supported in `claude -p --print` mode the way
        // we use it; flatten any assistant turns into the user prompt as
        // context. Rare for our generation pipeline.
        userChunks.push(`[previous assistant]: ${text}`);
      }
    }
  }

  if (explicitPrompt) userChunks.push(explicitPrompt);

  return {
    system: [explicitSystem, systemFromMessages].filter(Boolean).join('\n\n'),
    user: userChunks.join('\n\n'),
  };
}

function extractText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (!part || typeof part !== 'object') return '';
        const p = part as { type?: string; text?: string };
        if (p.type === 'text' && typeof p.text === 'string') return p.text;
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }
  return '';
}

/**
 * Call the Claude Code CLI and wrap the response in a shape that
 * looks like an AI SDK GenerateTextResult. Only `text` is populated;
 * `usage`, `finishReason`, etc. are filled with neutral defaults so
 * callers that read them don't crash.
 */
async function callClaudeCliCompat<T extends GenerateTextParams>(
  params: T,
  source: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<GenerateTextResult<any, any>> {
  const { system, user } = paramsToSystemUser(params);
  if (!user) {
    throw new Error(`claude-cli [${source}]: no user-role text content in params`);
  }
  const text = await executeClaudeCli({ systemPrompt: system, userPrompt: user });
  // Minimal shape matching what the generation pipeline actually reads
  // (mostly `.text`). Cast to AI SDK's result type so the public signature
  // of callLLM stays unchanged.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const stub: any = {
    text,
    finishReason: 'stop',
    usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    warnings: [],
    response: { id: `claude-cli-${Date.now()}`, modelId: 'claude-cli', timestamp: new Date() },
    request: {},
    providerMetadata: {},
    experimental_providerMetadata: {},
    responseMessages: [{ role: 'assistant', content: text }],
    steps: [],
    toolCalls: [],
    toolResults: [],
    rawCall: { rawPrompt: null, rawSettings: {} },
    rawResponse: { headers: {} },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return stub as GenerateTextResult<any, any>;
}

/**
 * Unified wrapper around `generateText`.
 *
 * @param params - Same parameters as AI SDK's `generateText`
 * @param source - A short label for log grouping (e.g. 'scene-stream', 'pbl-chat')
 * @param retryOptions - Optional retry-on-validation-failure settings
 * @param thinking - Optional per-call thinking config (overrides global LLM_THINKING_DISABLED)
 */
export async function callLLM<T extends GenerateTextParams>(
  params: T,
  source: string,
  retryOptions?: LLMRetryOptions,
  thinking?: ThinkingConfig,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<GenerateTextResult<any, any>> {
  // Claude Code CLI short-circuit — bypass the AI SDK entirely.
  if (isClaudeCliModel(params.model)) {
    return callClaudeCliCompat(params, source);
  }

  const maxAttempts = (retryOptions?.retries ?? 0) + 1;
  const validate = retryOptions?.validate ?? (maxAttempts > 1 ? DEFAULT_VALIDATE : undefined);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let lastResult: GenerateTextResult<any, any> | undefined;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      // Resolve effective thinking config: per-call > global env > undefined
      const effectiveThinking = thinking ?? getGlobalThinkingConfig();
      const injectedParams = injectProviderOptions(params, effectiveThinking);

      // Wrap in thinkingContext so the custom fetch wrapper in providers.ts
      // can read the config and inject vendor-specific body params for
      // OpenAI-compatible providers.
      const result = await thinkingContext.run(effectiveThinking, () =>
        generateText(injectedParams),
      );

      // Validate result (only when retries are configured)
      if (validate && !validate(result.text)) {
        log.warn(
          `[${source}] Validation failed (attempt ${attempt}/${maxAttempts}), ${attempt < maxAttempts ? 'retrying...' : 'giving up'}`,
        );
        lastResult = result;
        continue;
      }

      return result;
    } catch (error) {
      lastError = error;

      if (attempt < maxAttempts) {
        log.warn(`[${source}] Call failed (attempt ${attempt}/${maxAttempts}), retrying...`, error);
        continue;
      }
    }
  }

  // All attempts exhausted — return last result or throw last error
  if (lastResult) return lastResult;
  throw lastError;
}

/**
 * Unified wrapper around `streamText`.
 *
 * Returns the same StreamTextResult.
 *
 * @param params - Same parameters as AI SDK's `streamText`
 * @param source - A short label for log grouping
 * @param thinking - Optional per-call thinking config (overrides global LLM_THINKING_DISABLED)
 */
export function streamLLM<T extends StreamTextParams>(
  params: T,
  source: string,
  thinking?: ThinkingConfig,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): StreamTextResult<any, any> {
  // Claude Code CLI short-circuit — the CLI is non-streaming, so wrap the
  // single text response in an async iterable that yields one chunk. Most
  // downstream consumers only read `textStream`, so this is sufficient.
  if (isClaudeCliModel(params.model)) {
    return streamClaudeCliCompat(params, source);
  }

  // Resolve effective thinking config and wrap in thinkingContext
  const effectiveThinking = thinking ?? getGlobalThinkingConfig();
  const injectedParams = injectProviderOptions(params, effectiveThinking);
  const result = thinkingContext.run(effectiveThinking, () => streamText(injectedParams));

  return result;
}

/**
 * Streaming compatibility shim for `claude -p`. The CLI is request/response,
 * not streaming, so this yields the full text as a single chunk. We expose
 * the same `textStream`, `text`, `finishReason`, and `usage` accessors that
 * downstream consumers actually read.
 */
function streamClaudeCliCompat<T extends StreamTextParams>(
  params: T,
  source: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): StreamTextResult<any, any> {
  const { system, user } = paramsToSystemUser(params as unknown as GenerateTextParams);
  // Lazily resolve the CLI call so the iterator only runs when consumed.
  const textPromise: Promise<string> = (async () => {
    if (!user) {
      throw new Error(`claude-cli [${source}]: no user-role text content in params`);
    }
    return executeClaudeCli({ systemPrompt: system, userPrompt: user });
  })();

  const textStream = (async function* (): AsyncIterable<string> {
    yield await textPromise;
  })();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const stub: any = {
    textStream,
    text: textPromise,
    fullStream: textStream,
    finishReason: Promise.resolve('stop' as const),
    usage: Promise.resolve({ promptTokens: 0, completionTokens: 0, totalTokens: 0 }),
    warnings: Promise.resolve([] as never[]),
    toolCalls: Promise.resolve([] as never[]),
    toolResults: Promise.resolve([] as never[]),
    steps: Promise.resolve([] as never[]),
    response: Promise.resolve({
      id: `claude-cli-${Date.now()}`,
      modelId: 'claude-cli',
      timestamp: new Date(),
    }),
    request: Promise.resolve({}),
    providerMetadata: Promise.resolve({}),
    experimental_providerMetadata: Promise.resolve({}),
    rawCall: Promise.resolve({ rawPrompt: null, rawSettings: {} }),
    rawResponse: Promise.resolve({ headers: {} }),
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return stub as StreamTextResult<any, any>;
}

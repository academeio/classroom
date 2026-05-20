/**
 * OpenAI Codex CLI adapter — uses the user's local `codex exec` subscription
 * instead of the OpenAI API for LLM calls. Same idea as lib/ai/claude-cli.ts
 * but for ChatGPT subscriptions.
 *
 * Why this exists:
 *   The OpenAI API costs per token. Users with ChatGPT/Plus/Pro subscriptions
 *   already pay a flat fee and can invoke `codex exec` for free. This adapter
 *   wires that into the same `callLLM` / `streamLLM` surface as the API
 *   providers, so swapping is just a model-string change.
 *
 * How it works:
 *   1. `codex exec` is invoked in non-interactive mode with `--ephemeral`
 *      (no session persisted) and `--ignore-user-config` (clean run).
 *   2. Codex doesn't expose a `--system-prompt` flag, so we combine our
 *      system + user prompts into one stdin payload with a clear separator.
 *      The model still respects the "SYSTEM INSTRUCTIONS" framing.
 *   3. `-o <file>` writes just the final assistant message to a tempfile,
 *      avoiding the noise of session-id / tokens-used lines in stdout.
 *
 * Detection:
 *   The model is a sentinel `{ __isCodexCli: true, modelId }`. callLLM
 *   checks this marker before invoking the AI SDK and routes to the CLI
 *   path when set.
 *
 * Limitations (v1):
 *   - No streaming. The CLI returns the full message once Codex finishes.
 *   - No image/vision input (text only).
 *   - System prompt is concatenated into user input rather than a true
 *     system turn; the model still follows it but with weaker adherence
 *     than a real system role. Most generation prompts are robust enough.
 *   - Tokens used per call are higher than the API (Codex includes a
 *     default agent system prompt even with --ignore-user-config), but
 *     this counts against subscription quota, not API spend.
 */

import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLogger } from '@/lib/logger';

const log = createLogger('CodexCli');

/** Sentinel attached to the "model" object so callLLM can detect us. */
export interface CodexCliModel {
  readonly __isCodexCli: true;
  readonly modelId: string;
}

export function isCodexCliModel(model: unknown): model is CodexCliModel {
  return !!model && typeof model === 'object' && (model as { __isCodexCli?: unknown }).__isCodexCli === true;
}

export function createCodexCliModel(modelId: string): CodexCliModel {
  return { __isCodexCli: true, modelId };
}

const DEFAULT_TIMEOUT_MS = 600_000;

export interface CodexCliCallOptions {
  systemPrompt: string;
  userPrompt: string;
  /** Optional explicit Codex model to pass via `-c model=...`. */
  modelId?: string;
  /** Override path to the codex binary. */
  bin?: string;
  /** Subprocess timeout in milliseconds. Default 10 min. */
  timeoutMs?: number;
}

/**
 * Run `codex exec` and return the model's final message.
 * Throws on non-zero exit, timeout, or empty output.
 */
export async function executeCodexCli({
  systemPrompt,
  userPrompt,
  modelId,
  bin,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}: CodexCliCallOptions): Promise<string> {
  if (!userPrompt || !userPrompt.trim()) {
    throw new Error('codex-cli: userPrompt is empty');
  }

  const executable = bin || process.env.CODEX_CLI_BIN || 'codex';

  // Codex has no --system-prompt flag, so frame the system instructions
  // as a leading block within the single prompt payload. The model treats
  // SYSTEM INSTRUCTIONS as authoritative because of the explicit framing.
  const combined = systemPrompt
    ? `=== SYSTEM INSTRUCTIONS (follow strictly, do NOT echo back) ===\n${systemPrompt}\n\n=== USER REQUEST ===\n${userPrompt}`
    : userPrompt;

  // Write the assistant's final message to a tempfile so we get clean text
  // rather than parsing the conversational stdout (which includes session-id,
  // tokens-used, and other noise).
  const dir = await mkdtemp(join(tmpdir(), 'codex-cli-'));
  const outPath = join(dir, 'last-message.txt');

  const args = [
    'exec',
    '--ephemeral',
    '--skip-git-repo-check',
    '--ignore-user-config',
    '--color', 'never',
    '-o', outPath,
  ];
  // Model override: ChatGPT-account Codex only supports a fixed set of models
  // (e.g. gpt-5-codex). Passing an unsupported `-c model=` returns HTTP 400.
  // So we DON'T override by default — Codex uses the subscription's default
  // model. Only override when CODEX_CLI_MODEL is explicitly set by the operator
  // to a value they know their account supports. The per-call modelId from the
  // provider catalog is treated as informational only.
  const overrideModel = process.env.CODEX_CLI_MODEL;
  if (overrideModel) {
    args.push('-c', `model="${overrideModel.replace(/"/g, '\\"')}"`);
  }
  void modelId; // catalog modelId is informational; see note above
  // Trailing `-` tells codex to read the prompt from stdin.
  args.push('-');

  log.debug({ chars: userPrompt.length, system_chars: systemPrompt.length }, 'codex-cli: invoking');
  const start = Date.now();

  const child = spawn(executable, args, {
    cwd: process.env.CODEX_CLI_CWD || '/tmp',
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => {
    stderr += chunk;
  });
  // We don't need stdout — the assistant message goes to `-o outPath`.
  child.stdout.resume();

  child.stdin.write(combined);
  child.stdin.end();

  const timeoutHandle = setTimeout(() => {
    child.kill('SIGKILL');
  }, timeoutMs);

  const exitCode = await new Promise<number | null>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code) => resolve(code));
  });
  clearTimeout(timeoutHandle);

  let text = '';
  try {
    text = (await readFile(outPath, 'utf8')).trim();
  } catch {
    // tempfile not written — surface the exit-code/stderr error below
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }

  const elapsedMs = Date.now() - start;

  if (exitCode !== 0) {
    const tail = stderr.slice(-2000) || text.slice(-500);
    throw new Error(`codex-cli: process exited with code ${exitCode} after ${elapsedMs}ms\n${tail}`);
  }

  if (!text) {
    throw new Error(`codex-cli: empty output (stderr: ${stderr.slice(-500)})`);
  }

  log.debug({ elapsedMs, response_chars: text.length }, 'codex-cli: success');
  return text;
}

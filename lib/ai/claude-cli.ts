/**
 * Claude Code CLI adapter — uses the user's local `claude -p` subscription
 * instead of the Anthropic API for LLM calls. Same interface as the AI SDK
 * model adapters from a caller's perspective, but bypasses the API entirely.
 *
 * Why this exists:
 *   The Anthropic API costs per token. Users with Claude Max subscriptions
 *   already pay a flat fee and can use `claude -p` for free. Wiring this
 *   into the generation pipeline lets cost-sensitive deployments run
 *   classroom generation at near-zero LLM cost.
 *
 * How it works:
 *   1. `claude -p` is invoked in subprocess mode (--print). It reads the
 *      OAuth token from the user's Keychain — no API key needed.
 *   2. `--system-prompt` REPLACES the default Claude Code system prompt
 *      with ours, so our medical / outline / quiz instructions are the
 *      only system context.
 *   3. User prompt is piped via stdin.
 *   4. stdout is the plain model response text (when --output-format=text,
 *      which is the default).
 *
 * Detection:
 *   The model is a sentinel object with `__isClaudeCli: true`. callLLM
 *   checks this marker before invoking the AI SDK and routes to the CLI
 *   path when set. See lib/ai/llm.ts.
 *
 * Limitations (v1):
 *   - No image/vision input. The Claude CLI does support images via
 *     attachments, but threading them through is left for v2.
 *   - No streaming. Generation pipeline doesn't currently need it.
 *   - Concurrent calls serialise through the Keychain on macOS; large
 *     fan-outs may bottleneck. See feedback_subprocess_oauth_token_injection
 *     in MEMORY for context.
 */

import { spawn } from 'node:child_process';
import { createLogger } from '@/lib/logger';

const log = createLogger('ClaudeCli');

/** Sentinel attached to the "model" object so callLLM can detect us. */
export interface ClaudeCliModel {
  readonly __isClaudeCli: true;
  /** Model ID (e.g. `claude-sonnet-4-5`) — currently informational only; the
   *  CLI uses whatever the user has selected in their session settings. */
  readonly modelId: string;
}

export function isClaudeCliModel(model: unknown): model is ClaudeCliModel {
  return !!model && typeof model === 'object' && (model as { __isClaudeCli?: unknown }).__isClaudeCli === true;
}

export function createClaudeCliModel(modelId: string): ClaudeCliModel {
  return { __isClaudeCli: true, modelId };
}

const DEFAULT_TIMEOUT_MS = 600_000; // 10 minutes — large prompts can be slow

export interface ClaudeCliCallOptions {
  systemPrompt: string;
  userPrompt: string;
  /** Optional override; defaults to env `CLAUDE_CLI_BIN` then "claude" on PATH. */
  bin?: string;
  /** Subprocess timeout in milliseconds. Default 10 min. */
  timeoutMs?: number;
  /** Working directory; defaults to a quiet temp dir to avoid CLAUDE.md
   *  auto-discovery polluting the prompt context. */
  cwd?: string;
}

/**
 * Run `claude -p --system-prompt <sys> < <user>` and return stdout text.
 * Throws on non-zero exit, timeout, or empty stdout.
 */
export async function executeClaudeCli({
  systemPrompt,
  userPrompt,
  bin,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  cwd,
}: ClaudeCliCallOptions): Promise<string> {
  if (!userPrompt || !userPrompt.trim()) {
    throw new Error('claude-cli: userPrompt is empty');
  }

  const executable = bin || process.env.CLAUDE_CLI_BIN || 'claude';
  // `--print` (-p) makes it non-interactive. `--system-prompt` REPLACES the
  // default Claude Code system prompt, so our prompt is the only context.
  // We intentionally DO NOT use --bare because --bare disables OAuth/keychain
  // reads, which would force ANTHROPIC_API_KEY use and defeat the purpose
  // (the whole point of this adapter is subscription-based access).
  const args = ['-p', '--system-prompt', systemPrompt, '--output-format', 'text'];

  log.debug({ chars: userPrompt.length, system_chars: systemPrompt.length }, 'claude-cli: invoking');
  const start = Date.now();

  const child = spawn(executable, args, {
    cwd: cwd || process.env.CLAUDE_CLI_CWD || '/tmp',
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.on('data', (chunk: string) => {
    stderr += chunk;
  });

  child.stdin.write(userPrompt);
  child.stdin.end();

  const timeoutHandle = setTimeout(() => {
    child.kill('SIGKILL');
  }, timeoutMs);

  const exitCode = await new Promise<number | null>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code) => resolve(code));
  });
  clearTimeout(timeoutHandle);

  const elapsedMs = Date.now() - start;

  if (exitCode !== 0) {
    const tail = stderr.slice(-2000) || stdout.slice(-2000);
    throw new Error(
      `claude-cli: process exited with code ${exitCode} after ${elapsedMs}ms\n${tail}`,
    );
  }

  const text = stdout.trim();
  if (!text) {
    throw new Error(`claude-cli: empty stdout (stderr: ${stderr.slice(-500)})`);
  }

  log.debug({ elapsedMs, response_chars: text.length }, 'claude-cli: success');
  return text;
}

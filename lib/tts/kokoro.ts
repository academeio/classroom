/**
 * Kokoro 82M local TTS adapter — Python subprocess wrapper. Returns WAV.
 *
 * Reuses academe-video-gen's existing venv by default (kokoro 0.9.4 is
 * preinstalled there). Override via env:
 *   KOKORO_PYTHON   absolute path to a python with kokoro installed
 *   KOKORO_SCRIPT   absolute path to scripts/kokoro_tts.py
 *
 * No network calls — useful when Sarvam is rate-limited, offline, or you
 * want deterministic builds.
 */

import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TTSOptions, TTSResult } from './types';

const DEFAULT_TIMEOUT_MS = 300_000;
const SAMPLE_RATE = 24_000;
const MAX_CHARS = 800;

// Kokoro's local inference can OOM on very long texts. Split at sentence
// boundaries above this threshold and concatenate the resulting WAV chunks.
function splitIntoChunks(text: string, maxChars = MAX_CHARS): string[] {
  if (text.length <= maxChars) return [text];
  const chunks: string[] = [];
  const sentences = text.split(/(?<=[.!?])\s+/);
  let current = '';
  for (const sentence of sentences) {
    const candidate = current ? `${current} ${sentence}` : sentence;
    if (candidate.length <= maxChars) {
      current = candidate;
    } else {
      if (current) chunks.push(current);
      if (sentence.length > maxChars) {
        for (let i = 0; i < sentence.length; i += maxChars) {
          chunks.push(sentence.slice(i, i + maxChars));
        }
        current = '';
      } else {
        current = sentence;
      }
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

interface WavHeader {
  channels: number;
  sampleRate: number;
  bitsPerSample: number;
}

function parseWavHeader(buf: Buffer): WavHeader {
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('kokoro: not a valid WAV buffer');
  }
  // Walk RIFF chunks to find 'fmt '
  let offset = 12;
  while (offset + 8 <= buf.length) {
    const id = buf.toString('ascii', offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    if (id === 'fmt ') {
      return {
        channels: buf.readUInt16LE(offset + 10),
        sampleRate: buf.readUInt32LE(offset + 12),
        bitsPerSample: buf.readUInt16LE(offset + 22),
      };
    }
    offset += 8 + size;
  }
  throw new Error('kokoro: fmt chunk not found');
}

function concatenateWavBuffers(buffers: Buffer[]): Buffer {
  if (buffers.length === 1) return buffers[0];
  const { channels, sampleRate, bitsPerSample } = parseWavHeader(buffers[0]);
  const pcmChunks = buffers.map((buf) => {
    let offset = 12;
    while (offset + 8 <= buf.length) {
      const id = buf.toString('ascii', offset, offset + 4);
      const size = buf.readUInt32LE(offset + 4);
      if (id === 'data') return buf.slice(offset + 8, offset + 8 + size);
      offset += 8 + size;
    }
    throw new Error('kokoro: data chunk not found in WAV buffer');
  });
  const pcm = Buffer.concat(pcmChunks);
  const dataSize = pcm.length;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + dataSize, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * channels * (bitsPerSample / 8), 28);
  header.writeUInt16LE(channels * (bitsPerSample / 8), 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(dataSize, 40);
  return Buffer.concat([header, pcm]);
}

// Output format defaults to MP3 (smaller files, ~3× smaller than WAV).
// Override per call via `format: 'wav'` in opts, or globally via KOKORO_FORMAT.
type KokoroFormat = 'mp3' | 'wav';

function resolveFormat(opt?: KokoroFormat): KokoroFormat {
  if (opt === 'mp3' || opt === 'wav') return opt;
  const env = (process.env.KOKORO_FORMAT || '').toLowerCase();
  if (env === 'wav') return 'wav';
  return 'mp3';
}

export async function synthesize(
  opts: TTSOptions & { format?: KokoroFormat },
): Promise<TTSResult> {
  const { text, voice, pace = 1.0, lang = 'a' } = opts;
  if (!text || typeof text !== 'string') throw new Error('kokoro: text is required');

  const format = resolveFormat(opts.format);

  const chunks = splitIntoChunks(text);
  if (chunks.length > 1) {
    const parts: Buffer[] = [];
    for (const chunk of chunks) {
      // eslint-disable-next-line no-await-in-loop
      const r = await synthesize({ text: chunk, voice, pace, lang, format });
      parts.push(r.buffer);
    }
    // WAV needs proper header recomputation; MP3 streams concatenate by
    // simple byte append (browsers tolerate sequential frames without
    // a fresh ID3 header).
    const merged =
      format === 'wav' ? concatenateWavBuffers(parts) : Buffer.concat(parts);
    return { buffer: merged, format };
  }

  // Default to our self-contained script; fall back to academe-video-gen for
  // backwards compatibility, then env override.
  const here = new URL('.', import.meta.url).pathname;
  const localScript = join(here, '..', '..', 'scripts', 'kokoro_tts.py');
  const python =
    process.env.KOKORO_PYTHON || '/Users/jagan/Developer/academe-video-gen/.venv/bin/python';
  const script = process.env.KOKORO_SCRIPT || localScript;

  const dir = await mkdtemp(join(tmpdir(), 'kokoro-'));
  const outPath = join(dir, `out.${format}`);

  const args = [
    script,
    '--text', text,
    '--voice', voice,
    '--lang', lang,
    '--speed', String(pace),
    '--output', outPath,
    '--sample-rate', String(SAMPLE_RATE),
    '--format', format,
  ];

  // TS doesn't narrow closure-modified vars, so collect the result into a
  // single object the callback can fully replace, then destructure after await.
  const execState: {
    err: { message: string; killed: boolean } | null;
    stderr: string;
  } = { err: null, stderr: '' };
  await new Promise<void>((resolve) => {
    execFile(
      python,
      args,
      { timeout: DEFAULT_TIMEOUT_MS, maxBuffer: 20 * 1024 * 1024 },
      (err, _stdout, stderr) => {
        execState.err = err
          ? { message: err.message, killed: (err as { killed?: boolean }).killed ?? false }
          : null;
        execState.stderr = (stderr ?? '').toString();
        resolve();
      },
    );
  });
  const execErr = execState.err;
  const execStderr = execState.stderr;

  let buffer: Buffer;
  try {
    buffer = await readFile(outPath);
  } catch {
    if (execErr) {
      const tail = execStderr.slice(-2000);
      throw new Error(`kokoro: python exited with error: ${execErr.message}\nstderr: ${tail}`);
    }
    throw new Error(`kokoro: output ${format.toUpperCase()} file not found after synthesis`);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }

  if (execErr && execErr.killed) {
    const tail = execStderr.slice(-2000);
    throw new Error(
      `kokoro: process killed (timeout?) — discarding partial ${format.toUpperCase()}\nstderr: ${tail}`,
    );
  }
  // Kokoro sometimes exits non-zero even when it wrote a usable file
  // (e.g. on phonetic-notation edge cases). Trust the audio.

  return { buffer, format };
}

// ── Kokoro voice pairs — male+female dual-narrator combinations ──

export const KOKORO_VOICE_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ['af_heart', 'bm_george'],
  ['bf_emma', 'bm_george'],
  ['af_heart', 'am_adam'],
  ['bf_emma', 'am_adam'],
] as const;

/**
 * Pick a [female, male] voice pair. Matches the tuple convention used
 * elsewhere in the classroom pipeline.
 */
export function pickKokoroVoicePair(): [string, string] {
  const pair = KOKORO_VOICE_PAIRS[Math.floor(Math.random() * KOKORO_VOICE_PAIRS.length)];
  return [pair[0], pair[1]];
}

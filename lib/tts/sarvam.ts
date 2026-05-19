/**
 * Sarvam AI TTS adapter — cloud-based, Indian English (en-IN) voices via
 * Bulbul v3. Returns MP3.
 *
 * Requires SARVAM_API_KEY in the environment.
 */

import type { TTSOptions, TTSResult } from './types';

const SARVAM_ENDPOINT = 'https://api.sarvam.ai/text-to-speech';
const MAX_CHARS = 2400;

/**
 * Preprocess speech text so Sarvam reads number ranges and units naturally.
 * Kokoro handles raw numbers fine, so this lives in the Sarvam adapter only.
 */
function preprocessForSarvam(text: string): string {
  return text
    .replace(/(\d+)\s*[-–—]\s*(\d+)/g, '$1 to $2')
    .replace(/(\d+)\s*[-–—]\s*(\d+)([a-zA-Z])/g, '$1 to $2$3')
    .replace(/(\d)(cm|mm|kg|mg|ml|mmHg|mL|dL|µm|nm)\b/gi, '$1 $2')
    .replace(/(\d)\s*%/g, '$1 percent');
}

export async function synthesize({
  text,
  voice,
  pace = 1.0,
}: TTSOptions): Promise<TTSResult> {
  const apiKey = process.env.SARVAM_API_KEY;
  if (!apiKey) throw new Error('SARVAM_API_KEY not set in .env.local');

  const processed = preprocessForSarvam(text);
  const truncated = processed.length > MAX_CHARS ? `${processed.slice(0, MAX_CHARS)}.` : processed;

  const resp = await fetch(SARVAM_ENDPOINT, {
    method: 'POST',
    headers: {
      'api-subscription-key': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      text: truncated,
      target_language_code: 'en-IN',
      model: 'bulbul:v3',
      speaker: voice,
      pace,
      output_audio_codec: 'mp3',
    }),
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw new Error(`Sarvam API ${resp.status}: ${body}`);
  }

  const data = (await resp.json()) as { audios?: string[] };
  if (!data.audios || !data.audios[0]) {
    throw new Error('Sarvam API returned no audio');
  }

  return { buffer: Buffer.from(data.audios[0], 'base64'), format: 'mp3' };
}

// ── Voice pool — known Sarvam Bulbul v3 speakers ──

export const SARVAM_MALE_VOICES = ['rahul', 'amit', 'dev', 'varun'];
export const SARVAM_FEMALE_VOICES = ['kavitha', 'priya', 'kavya', 'shreya', 'simran'];

/**
 * Pick a random female+male pair for a 2-voice classroom narration.
 * Tuple order is [female, male] to match the existing alternation index.
 */
export function pickSarvamVoicePair(): [string, string] {
  const female = SARVAM_FEMALE_VOICES[Math.floor(Math.random() * SARVAM_FEMALE_VOICES.length)];
  const male = SARVAM_MALE_VOICES[Math.floor(Math.random() * SARVAM_MALE_VOICES.length)];
  return [female, male];
}

/**
 * TTS dispatcher — pick a provider, get a synthesizer + voice picker.
 *
 * Common surface: { text, voice, pace?, lang? } → { buffer, format }.
 * R2 upload + downstream playback are format-agnostic.
 */

import { synthesize as synthesizeSarvam, pickSarvamVoicePair } from './sarvam';
import { synthesize as synthesizeKokoro, pickKokoroVoicePair } from './kokoro';
import type { TTSProviderId, TTSSynthesizer } from './types';

export const TTS_PROVIDERS: Record<TTSProviderId, TTSSynthesizer> = {
  sarvam: synthesizeSarvam,
  kokoro: synthesizeKokoro,
};

export const DEFAULT_VOICES: Record<TTSProviderId, string> = {
  sarvam: 'kavitha',
  kokoro: 'af_heart',
};

/** Pick a [female, male] voice pair appropriate for the chosen provider. */
export function pickVoicePair(provider: TTSProviderId): [string, string] {
  switch (provider) {
    case 'kokoro':
      return pickKokoroVoicePair();
    case 'sarvam':
    default:
      return pickSarvamVoicePair();
  }
}

export function getSynthesizer(provider: TTSProviderId): TTSSynthesizer {
  const fn = TTS_PROVIDERS[provider];
  if (!fn) {
    const available = Object.keys(TTS_PROVIDERS).join(', ');
    throw new Error(`Unknown TTS provider "${provider}". Available: ${available}`);
  }
  return fn;
}

export function isValidProvider(value: string): value is TTSProviderId {
  return value === 'sarvam' || value === 'kokoro';
}

export type { TTSResult, TTSOptions, TTSFormat, TTSProviderId, TTSSynthesizer } from './types';

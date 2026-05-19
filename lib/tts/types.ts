/**
 * TTS provider abstraction — common surface for Sarvam, Kokoro, and future
 * providers. Each provider returns a raw audio buffer with its native format;
 * R2 upload and downstream playback are format-agnostic.
 */

export type TTSFormat = 'mp3' | 'wav';

export interface TTSResult {
  /** Raw audio bytes, ready to upload to R2. */
  buffer: Buffer;
  /** File extension used when uploading (drives Content-Type via the R2 client). */
  format: TTSFormat;
}

export interface TTSOptions {
  text: string;
  voice: string;
  /** Speaking pace; provider-specific scale (Sarvam ~0.5–2.0, Kokoro ~0.5–2.0). */
  pace?: number;
  /** Language hint. `en` is the default everywhere; provider mapping handled internally. */
  lang?: string;
}

export type TTSSynthesizer = (opts: TTSOptions) => Promise<TTSResult>;

export type TTSProviderId = 'sarvam' | 'kokoro';

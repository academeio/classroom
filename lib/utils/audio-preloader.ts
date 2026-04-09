/**
 * Audio Pre-loader - Fetches all pre-rendered TTS audio for a classroom
 * from R2 via a manifest.json and stores them in IndexedDB so the
 * AudioPlayer finds them instantly during playback.
 *
 * Non-blocking: playback can start even if pre-loading is still in progress.
 * Falls back to old Neon-based loading for classrooms without a manifestUrl.
 */

import { db } from '@/lib/utils/database';
import { createLogger } from '@/lib/logger';

const log = createLogger('AudioPreloader');

interface AudioManifest {
  classroomId: string;
  audioFiles: Array<{ audioId: string; url: string }>;
  generatedAt: string;
}

/**
 * Pre-load audio from an R2 manifest URL.
 * Fetches manifest, then parallel-downloads all audio files into IndexedDB.
 */
export async function preloadFromManifest(manifestUrl: string): Promise<number> {
  const resp = await fetch(manifestUrl);
  if (!resp.ok) {
    log.warn(`Manifest fetch failed (${resp.status}): ${manifestUrl}`);
    return 0;
  }

  const manifest: AudioManifest = await resp.json();
  if (!manifest.audioFiles || manifest.audioFiles.length === 0) {
    log.info('Manifest has no audio files');
    return 0;
  }

  log.info(`Pre-loading ${manifest.audioFiles.length} audio files from R2`);

  // Parallel fetch all audio files
  const results = await Promise.allSettled(
    manifest.audioFiles.map(async (file) => {
      // Skip if already in IndexedDB
      const existing = await db.audioFiles.get(file.audioId);
      if (existing) return true;

      const audioResp = await fetch(file.url);
      if (!audioResp.ok) {
        log.warn(`Failed to fetch audio ${file.audioId}: ${audioResp.status}`);
        return false;
      }

      const blob = await audioResp.blob();
      const format = file.url.endsWith('.mp3') ? 'mp3' : 'wav';

      await db.audioFiles.put({
        id: file.audioId,
        blob,
        format,
        createdAt: Date.now(),
      });

      return true;
    }),
  );

  const loaded = results.filter((r) => r.status === 'fulfilled' && r.value).length;
  log.info(`Pre-loaded ${loaded}/${manifest.audioFiles.length} audio files`);
  return loaded;
}

/**
 * Legacy: Pre-load from Neon API (for old classrooms without manifestUrl).
 */
export async function preloadClassroomAudio(classroomId: string): Promise<number> {
  const resp = await fetch(`/api/classroom-audio?classroomId=${encodeURIComponent(classroomId)}`);
  if (!resp.ok) {
    log.warn(`Batch audio fetch returned ${resp.status}`);
    return 0;
  }

  const data = await resp.json();
  if (!data.success || !data.audioFiles || data.audioFiles.length === 0) {
    log.info('No pre-rendered audio for classroom:', classroomId);
    return 0;
  }

  log.info(`Pre-loading ${data.audioFiles.length} audio files from Neon (legacy)`);

  let loaded = 0;
  for (const file of data.audioFiles as Array<{ audioId: string; base64: string; format: string }>) {
    try {
      const existing = await db.audioFiles.get(file.audioId);
      if (existing) {
        loaded++;
        continue;
      }

      const binaryStr = atob(file.base64);
      const bytes = new Uint8Array(binaryStr.length);
      for (let i = 0; i < binaryStr.length; i++) {
        bytes[i] = binaryStr.charCodeAt(i);
      }
      const blob = new Blob([bytes], { type: `audio/${file.format}` });

      await db.audioFiles.put({
        id: file.audioId,
        blob,
        format: file.format,
        createdAt: Date.now(),
      });

      loaded++;
    } catch (err) {
      log.warn(`Failed to pre-load audio ${file.audioId}:`, err);
    }
  }

  log.info(`Pre-loaded ${loaded}/${data.audioFiles.length} audio files (legacy)`);
  return loaded;
}

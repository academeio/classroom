/**
 * Audio Pre-loader - Fetches all pre-rendered TTS audio for a classroom
 * from the server (Neon) and stores them in IndexedDB so the AudioPlayer
 * finds them instantly during playback.
 *
 * This is non-blocking: playback can start even if pre-loading is still
 * in progress. The server TTS fallback remains available for any audio
 * that hasn't been pre-loaded yet.
 */

import { db } from '@/lib/utils/database';
import { createLogger } from '@/lib/logger';

const log = createLogger('AudioPreloader');

/**
 * Fetch all pre-rendered audio for a classroom from the server and
 * populate IndexedDB. Skips audio IDs that are already cached locally.
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

  log.info(`Pre-loading ${data.audioFiles.length} audio files for classroom:`, classroomId);

  let loaded = 0;

  for (const file of data.audioFiles as Array<{ audioId: string; base64: string; format: string }>) {
    try {
      // Skip if already in IndexedDB
      const existing = await db.audioFiles.get(file.audioId);
      if (existing) {
        loaded++;
        continue;
      }

      // Decode base64 to Blob
      const binaryStr = atob(file.base64);
      const bytes = new Uint8Array(binaryStr.length);
      for (let i = 0; i < binaryStr.length; i++) {
        bytes[i] = binaryStr.charCodeAt(i);
      }
      const blob = new Blob([bytes], { type: `audio/${file.format}` });

      // Store in IndexedDB (same schema as AudioFileRecord)
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

  log.info(`Pre-loaded ${loaded}/${data.audioFiles.length} audio files`);
  return loaded;
}

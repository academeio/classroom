/**
 * Neon Audio Store - Server-side storage for pre-rendered TTS audio
 *
 * Stores base64-encoded audio in the classroom_audio table.
 * Used by the generation script to persist pre-rendered TTS and
 * by the API to serve audio to the playback client.
 */

import { getDb } from '@/lib/neon/client';

export async function saveAudio(
  audioId: string,
  classroomId: string,
  base64Audio: string,
  format: string = 'mp3',
): Promise<void> {
  const sql = getDb();
  await sql`
    INSERT INTO classroom_audio (audio_id, classroom_id, base64_audio, format)
    VALUES (${audioId}, ${classroomId}, ${base64Audio}, ${format})
    ON CONFLICT (audio_id) DO NOTHING
  `;
}

export async function getAudio(
  audioId: string,
): Promise<{ base64: string; format: string } | null> {
  const sql = getDb();
  const rows = await sql`
    SELECT base64_audio as base64, format FROM classroom_audio WHERE audio_id = ${audioId}
  `;
  return rows.length > 0 ? { base64: rows[0].base64, format: rows[0].format } : null;
}

export async function getClassroomAudio(
  classroomId: string,
): Promise<Array<{ audioId: string; base64: string; format: string }>> {
  const sql = getDb();
  const rows = await sql`
    SELECT audio_id, base64_audio as base64, format
    FROM classroom_audio
    WHERE classroom_id = ${classroomId}
  `;
  return rows.map((r: Record<string, string>) => ({ audioId: r.audio_id, base64: r.base64, format: r.format }));
}

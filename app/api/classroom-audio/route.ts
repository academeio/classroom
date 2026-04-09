/**
 * Batch Audio Retrieval API
 *
 * GET /api/classroom-audio?classroomId={id}
 * Returns all pre-rendered TTS audio files for a classroom in one request.
 * Used by the playback page to pre-load audio into IndexedDB.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getClassroomAudio } from '@/lib/storage/neon-audio-store';

export async function GET(request: NextRequest) {
  const classroomId = request.nextUrl.searchParams.get('classroomId');
  if (!classroomId) {
    return NextResponse.json({ error: 'classroomId required' }, { status: 400 });
  }

  const audioFiles = await getClassroomAudio(classroomId);
  return NextResponse.json({ success: true, audioFiles });
}

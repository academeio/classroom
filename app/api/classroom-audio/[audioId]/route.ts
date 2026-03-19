/**
 * Single Audio Retrieval API
 *
 * GET /api/classroom-audio/[audioId]
 * Returns pre-rendered TTS audio by its ID.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAudio } from '@/lib/storage/neon-audio-store';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ audioId: string }> },
) {
  const { audioId } = await params;

  const audio = await getAudio(audioId);
  if (!audio) {
    return NextResponse.json({ error: 'Audio not found' }, { status: 404 });
  }

  return NextResponse.json({
    success: true,
    audioId,
    base64: audio.base64,
    format: audio.format,
  });
}

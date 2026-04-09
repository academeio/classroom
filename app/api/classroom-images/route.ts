import { type NextRequest, NextResponse } from 'next/server';
import { getClassroomImages, getImage } from '@/lib/storage/neon-image-store';

export async function GET(request: NextRequest) {
  const classroomId = request.nextUrl.searchParams.get('classroomId');
  const imageId = request.nextUrl.searchParams.get('imageId');

  // Single image — return as binary for direct use as img src
  if (imageId) {
    const image = await getImage(imageId);
    if (!image) {
      return NextResponse.json({ error: 'Image not found' }, { status: 404 });
    }

    // Return as binary image (can be used directly as <img src>)
    const binary = Buffer.from(image.base64, 'base64');
    return new NextResponse(binary, {
      headers: {
        'Content-Type': image.mimeType,
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    });
  }

  // Batch: return all image IDs for a classroom (for preloading)
  if (classroomId) {
    const images = await getClassroomImages(classroomId);
    return NextResponse.json({
      success: true,
      images: images.map(i => ({
        imageId: i.imageId,
        mimeType: i.mimeType,
        url: `/api/classroom-images?imageId=${i.imageId}`,
      })),
    });
  }

  return NextResponse.json({ error: 'classroomId or imageId required' }, { status: 400 });
}

import { getDb } from '@/lib/neon/client';

export async function saveImage(
  imageId: string,
  classroomId: string,
  base64Image: string,
  mimeType: string = 'image/png',
): Promise<void> {
  const sql = getDb();
  await sql`
    INSERT INTO classroom_images (image_id, classroom_id, base64_image, mime_type)
    VALUES (${imageId}, ${classroomId}, ${base64Image}, ${mimeType})
    ON CONFLICT (image_id) DO NOTHING
  `;
}

export async function getImage(imageId: string): Promise<{ base64: string; mimeType: string } | null> {
  const sql = getDb();
  const rows = await sql`
    SELECT base64_image as base64, mime_type as "mimeType"
    FROM classroom_images WHERE image_id = ${imageId}
  `;
  return rows.length > 0 ? { base64: rows[0].base64 as string, mimeType: rows[0].mimeType as string } : null;
}

export async function getClassroomImages(
  classroomId: string,
): Promise<Array<{ imageId: string; base64: string; mimeType: string }>> {
  const sql = getDb();
  const rows = await sql`
    SELECT image_id as "imageId", base64_image as base64, mime_type as "mimeType"
    FROM classroom_images WHERE classroom_id = ${classroomId}
  `;
  return rows as Array<{ imageId: string; base64: string; mimeType: string }>;
}

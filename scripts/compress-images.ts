/**
 * Compress all existing classroom images in Neon.
 * Resizes to max 800px wide, converts to JPEG quality 80.
 *
 * Usage: npx tsx scripts/compress-images.ts
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(__dirname, '..', '.env.local') });

import sharp from 'sharp';
import { neon } from '@neondatabase/serverless';

async function main() {
  const sql = neon(process.env.DATABASE_URL!);

  const rows = await sql`SELECT image_id, base64_image, mime_type FROM classroom_images`;
  console.log(`Compressing ${rows.length} images...\n`);

  let totalBefore = 0;
  let totalAfter = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rawBuffer = Buffer.from(row.base64_image as string, 'base64');
    const beforeKB = Math.round(rawBuffer.length / 1024);
    totalBefore += rawBuffer.length;

    // Already small — skip
    if (rawBuffer.length < 100 * 1024) {
      console.log(`  [${i + 1}/${rows.length}] ${row.image_id}: ${beforeKB}KB — already small, skip`);
      totalAfter += rawBuffer.length;
      continue;
    }

    const compressed = await sharp(rawBuffer)
      .resize(800, null, { withoutEnlargement: true })
      .jpeg({ quality: 80 })
      .toBuffer();
    const afterKB = Math.round(compressed.length / 1024);
    totalAfter += compressed.length;

    const newBase64 = compressed.toString('base64');
    await sql`UPDATE classroom_images SET base64_image = ${newBase64}, mime_type = 'image/jpeg' WHERE image_id = ${row.image_id}`;
    console.log(`  [${i + 1}/${rows.length}] ${row.image_id}: ${beforeKB}KB → ${afterKB}KB`);
  }

  console.log(`\n${'='.repeat(50)}`);
  console.log(`Total: ${Math.round(totalBefore / 1024)}KB → ${Math.round(totalAfter / 1024)}KB`);
  console.log(`Reduction: ${Math.round((1 - totalAfter / totalBefore) * 100)}%`);
}

main().catch((err) => {
  console.error('Error:', err instanceof Error ? err.message : err);
  process.exit(1);
});

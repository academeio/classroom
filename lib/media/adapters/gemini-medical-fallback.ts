/**
 * Pre-existing Image Fallback
 *
 * When Gemini generation fails (API error, rate limit, timeout),
 * looks up matching images from canvascbme's capsule_images table
 * and copies them into OpenMAIC's classroom_images table.
 *
 * Both tables live in the same Neon database (fragrant-sea-37321263),
 * so this is a same-DB query, not a cross-service call.
 */

import { neon } from '@neondatabase/serverless';
import { saveImage } from '@/lib/storage/neon-image-store';

const sql = neon(process.env.DATABASE_URL!);

interface CapsuleImage {
  slug: string;
  title: string;
  alt_text: string;
  bunny_url: string;
  image_type: string;
  tags: string[];
  quality_score: number;
}

/**
 * Search capsule_images for a matching image by topic keywords.
 * Returns the best match (highest quality_score) or null.
 */
async function findMatchingCapsuleImage(
  searchTerms: string[],
): Promise<CapsuleImage | null> {
  if (searchTerms.length === 0) return null;

  try {
    // Search by tags overlap — find images whose tags intersect with search terms
    const rows = await sql`
      SELECT slug, title, alt_text, bunny_url, image_type, tags, quality_score
      FROM capsule_images
      WHERE tags && ${searchTerms}
      ORDER BY quality_score DESC NULLS LAST
      LIMIT 1
    `;
    return (rows[0] as CapsuleImage) || null;
  } catch (err) {
    // capsule_images table may not exist or be accessible — fail silently
    console.warn('[gemini-medical-fallback] capsule_images query failed:', err);
    return null;
  }
}

/**
 * Extract search terms from an image prompt.
 * Splits on common delimiters, lowercases, removes short words.
 */
function extractSearchTerms(prompt: string): string[] {
  return prompt
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 3)
    .slice(0, 10);
}

/**
 * Attempt to find a pre-existing image matching the prompt,
 * fetch it from CDN, and copy it into classroom_images.
 *
 * Returns the base64 image data if successful, null otherwise.
 */
export async function fallbackToExistingImage(
  prompt: string,
  elementId: string,
  classroomId: string,
): Promise<{ base64: string; mimeType: string } | null> {
  const terms = extractSearchTerms(prompt);
  const match = await findMatchingCapsuleImage(terms);
  if (!match || !match.bunny_url) return null;

  try {
    // Fetch image from CDN (R2 or Bunny)
    const response = await fetch(match.bunny_url);
    if (!response.ok) return null;

    const buffer = Buffer.from(await response.arrayBuffer());
    const base64 = buffer.toString('base64');
    const mimeType = response.headers.get('content-type') || 'image/jpeg';

    // Copy into OpenMAIC's classroom_images
    await saveImage(elementId, classroomId, base64, mimeType);

    console.log(
      `[gemini-medical-fallback] Used existing image "${match.title}" (${match.slug}) for ${elementId}`,
    );
    return { base64, mimeType };
  } catch (err) {
    console.warn('[gemini-medical-fallback] Failed to fetch/copy image:', err);
    return null;
  }
}

/**
 * Cloudflare R2 storage client for classroom media.
 *
 * Uploads images and audio to the classroom-media bucket,
 * served via classroom-media.academe.org.in.
 *
 * Uses S3-compatible API (same pattern as canvascbme's lib/r2.mjs).
 */

import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

let _client: S3Client | null = null;

function getClient(): S3Client {
  if (_client) return _client;

  const accountId = process.env.R2_CLASSROOM_ACCOUNT_ID;
  const accessKeyId = process.env.R2_CLASSROOM_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_CLASSROOM_SECRET_ACCESS_KEY;

  if (!accountId || !accessKeyId || !secretAccessKey) {
    throw new Error(
      'R2 credentials not configured. Set R2_CLASSROOM_ACCOUNT_ID, R2_CLASSROOM_ACCESS_KEY_ID, R2_CLASSROOM_SECRET_ACCESS_KEY in .env.local',
    );
  }

  _client = new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });

  return _client;
}

const BUCKET = () => process.env.R2_CLASSROOM_BUCKET || 'classroom-media';
const PUBLIC_URL = () => process.env.R2_CLASSROOM_PUBLIC_URL || 'https://classroom-media.academe.org.in';

/**
 * Upload a buffer to R2 and return the public CDN URL.
 */
export async function uploadToR2(
  key: string,
  body: Buffer,
  contentType: string,
  cacheControl: string = 'public, max-age=31536000, immutable',
): Promise<string> {
  const client = getClient();

  await client.send(
    new PutObjectCommand({
      Bucket: BUCKET(),
      Key: key,
      Body: body,
      ContentType: contentType,
      CacheControl: cacheControl,
    }),
  );

  return `${PUBLIC_URL()}/${key}`;
}

/**
 * Construct the public CDN URL for a key (without uploading).
 */
export function getR2PublicUrl(key: string): string {
  return `${PUBLIC_URL()}/${key}`;
}

/**
 * Upload a classroom image to R2.
 * @returns Public CDN URL for the image
 */
export async function uploadClassroomImage(
  classroomId: string,
  elementId: string,
  imageBuffer: Buffer,
): Promise<string> {
  const key = `${classroomId}/images/${elementId}.jpg`;
  return uploadToR2(key, imageBuffer, 'image/jpeg');
}

/**
 * Upload a TTS audio file to R2.
 * @returns Public CDN URL for the audio
 */
export async function uploadClassroomAudio(
  classroomId: string,
  audioId: string,
  audioBuffer: Buffer,
  format: string = 'mp3',
): Promise<string> {
  const key = `${classroomId}/audio/${audioId}.${format}`;
  return uploadToR2(key, audioBuffer, `audio/${format}`);
}

/**
 * Build and upload a manifest.json listing all audio files for a classroom.
 * @returns Public CDN URL for the manifest
 */
export async function uploadAudioManifest(
  classroomId: string,
  audioFiles: Array<{ audioId: string; url: string }>,
): Promise<string> {
  const manifest = {
    classroomId,
    audioFiles,
    generatedAt: new Date().toISOString(),
  };

  const key = `${classroomId}/manifest.json`;
  const buffer = Buffer.from(JSON.stringify(manifest, null, 2));
  return uploadToR2(key, buffer, 'application/json', 'public, max-age=3600');
}

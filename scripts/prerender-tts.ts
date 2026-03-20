/**
 * Pre-render TTS audio for existing classrooms.
 *
 * Fetches classroom data from Neon, generates TTS for all speech actions,
 * and stores the audio in the classroom_audio table.
 *
 * Usage:
 *   npx tsx scripts/prerender-tts.ts --classroom SrNVhpxHXJ
 *   npx tsx scripts/prerender-tts.ts --all-pilots
 *   npx tsx scripts/prerender-tts.ts --classroom SrNVhpxHXJ --voice en-IN-PrabhatNeural --speed 1.5
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(__dirname, '..', '.env.local') });

import { neon } from '@neondatabase/serverless';
import { saveAudio, getClassroomAudio } from '../lib/storage/neon-audio-store';

// ── Config ──

const DEFAULT_PROVIDER = 'azure-tts';
const DEFAULT_VOICE = 'en-IN-NeerjaNeural';
const DEFAULT_SPEED = 1.0;

// Voice rotation for variety — cycles through these for consecutive speech actions
const VOICE_POOL = [
  'en-IN-NeerjaNeural',    // Female — clear, professional
  'en-IN-PrabhatNeural',   // Male — warm, authoritative
  'en-IN-AaravNeural',     // Male — young, energetic
  'en-IN-KavyaNeural',     // Female — professional
];

// ── Args ──

function parseArgs() {
  const args = process.argv.slice(2);
  const parsed: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--') && i + 1 < args.length && !args[i + 1].startsWith('--')) {
      parsed[args[i].slice(2)] = args[++i];
    } else if (args[i] === '--all-pilots') {
      parsed['all-pilots'] = 'true';
    }
  }
  return parsed;
}

// ── TTS Generation via API ──

async function generateTTSViaAPI(
  baseUrl: string,
  text: string,
  audioId: string,
  providerId: string,
  voice: string,
  speed: number,
  cookie: string,
): Promise<{ base64: string; format: string }> {
  const resp = await fetch(`${baseUrl}/api/generate/tts`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: cookie,
    },
    body: JSON.stringify({
      text,
      audioId,
      ttsProviderId: providerId,
      ttsVoice: voice,
      ttsSpeed: speed,
    }),
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw new Error(`TTS API ${resp.status}: ${body}`);
  }

  const data = await resp.json();
  if (!data.success || !data.base64) {
    throw new Error(`TTS API error: ${data.error || 'no audio returned'}`);
  }

  return { base64: data.base64, format: data.format || 'mp3' };
}

// ── Auth ──

async function authenticate(baseUrl: string, password: string): Promise<string> {
  const resp = await fetch(`${baseUrl}/api/auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
    redirect: 'manual',
  });
  if (!resp.ok) throw new Error(`Auth failed: ${resp.status}`);
  const setCookie = resp.headers.get('set-cookie');
  return setCookie ? setCookie.split(';')[0] : '';
}

// ── Main ──

async function main() {
  const args = parseArgs();
  const baseUrl = args['base-url'] || 'https://classroom.cbme.in';
  const password = args.password || process.env.GENERATION_PASSWORD || '';
  const voice = args.voice || DEFAULT_VOICE;
  const speed = parseFloat(args.speed || String(DEFAULT_SPEED));
  const providerId = args.provider || DEFAULT_PROVIDER;

  if (!password) {
    console.error('Need --password or GENERATION_PASSWORD env var');
    process.exit(1);
  }

  const sql = neon(process.env.DATABASE_URL!);

  // Get classrooms to process
  let classroomIds: string[] = [];
  if (args['all-pilots']) {
    const rows = await sql`SELECT id, title FROM classrooms WHERE is_pilot = true ORDER BY created_at`;
    classroomIds = rows.map((r: any) => r.id);
    console.log(`Found ${classroomIds.length} pilot classrooms`);
    rows.forEach((r: any) => console.log(`  ${r.id} — ${r.title}`));
  } else if (args.classroom) {
    classroomIds = [args.classroom];
  } else {
    console.error('Usage: npx tsx scripts/prerender-tts.ts --all-pilots');
    console.error('       npx tsx scripts/prerender-tts.ts --classroom <id>');
    process.exit(1);
  }

  // Authenticate
  console.log('\nAuthenticating...');
  const cookie = await authenticate(baseUrl, password);
  console.log('Authenticated.');

  console.log(`\nTTS Config: provider=${providerId} voice=${voice} speed=${speed}x`);

  let totalRendered = 0;
  let totalSkipped = 0;
  let totalErrors = 0;

  for (const classroomId of classroomIds) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`Processing: ${classroomId}`);

    // Fetch classroom data
    const rows = await sql`SELECT classroom_data, title FROM classrooms WHERE id = ${classroomId}`;
    if (rows.length === 0) {
      console.log(`  NOT FOUND — skipping`);
      continue;
    }

    const data = typeof rows[0].classroom_data === 'string'
      ? JSON.parse(rows[0].classroom_data)
      : rows[0].classroom_data;
    const title = rows[0].title;
    console.log(`  Title: ${title}`);

    const scenes = data.scenes || [];
    console.log(`  Scenes: ${scenes.length}`);

    // Check what's already pre-rendered
    const existingAudio = await getClassroomAudio(classroomId);
    const existingIds = new Set(existingAudio.map((a: any) => a.audioId));
    console.log(`  Already pre-rendered: ${existingIds.size} audio files`);

    // Collect all speech actions
    const speechActions: Array<{ sceneTitle: string; actionId: string; text: string }> = [];
    for (const scene of scenes) {
      const actions = scene.actions || [];
      for (const action of actions) {
        if (action.type === 'speech' && action.text) {
          const audioId = action.id || action.audioId || `tts_${action.id}`;
          speechActions.push({
            sceneTitle: scene.title || 'Untitled',
            actionId: audioId,
            text: action.text,
          });
        }
      }
    }

    console.log(`  Speech actions: ${speechActions.length}`);

    // Pre-render each speech action
    for (let i = 0; i < speechActions.length; i++) {
      const { sceneTitle, actionId, text } = speechActions[i];

      // Skip if already rendered
      if (existingIds.has(actionId)) {
        totalSkipped++;
        continue;
      }

      process.stdout.write(`  [${i + 1}/${speechActions.length}] "${sceneTitle}" (${text.length} chars)... `);

      try {
        const { base64, format } = await generateTTSViaAPI(
          baseUrl, text, actionId, providerId, voice, speed, cookie,
        );
        await saveAudio(actionId, classroomId, base64, format);
        totalRendered++;
        console.log(`done (${Math.round(base64.length / 1024)}KB)`);
      } catch (err) {
        totalErrors++;
        console.log(`FAILED: ${err instanceof Error ? err.message : err}`);
      }
    }
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log(`TTS Pre-rendering Complete`);
  console.log(`  Rendered: ${totalRendered}`);
  console.log(`  Skipped (existing): ${totalSkipped}`);
  console.log(`  Errors: ${totalErrors}`);
  console.log('='.repeat(60));
}

main().catch((err) => {
  console.error('Fatal error:', err instanceof Error ? err.message : err);
  process.exit(1);
});

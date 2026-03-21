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
import { SARVAM_VOICE_MAP, DEFAULT_SARVAM_VOICE } from '../lib/orchestration/registry/medical-agents';

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

// ── TTS Generation via Sarvam AI ──

async function generateTTSViaSarvam(
  text: string,
  voice: string,
  pace: number = 1.0,
): Promise<{ base64: string; format: string }> {
  const apiKey = process.env.SARVAM_API_KEY;
  if (!apiKey) throw new Error('SARVAM_API_KEY not set in .env.local');

  // Sarvam limit: 2500 chars. Truncate if needed.
  const truncatedText = text.length > 2400 ? text.substring(0, 2400) + '.' : text;

  const resp = await fetch('https://api.sarvam.ai/text-to-speech', {
    method: 'POST',
    headers: {
      'api-subscription-key': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      text: truncatedText,
      target_language_code: 'en-IN',
      model: 'bulbul:v3',
      speaker: voice,
      pace,
      output_audio_codec: 'mp3',
    }),
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw new Error(`Sarvam API ${resp.status}: ${body}`);
  }

  const data = await resp.json();
  if (!data.audios || !data.audios[0]) {
    throw new Error('Sarvam API returned no audio');
  }

  return { base64: data.audios[0], format: 'mp3' };
}

// ── Agent voice lookup ──

// Voice rotation counter — cycles through voices for variety
let voiceRotationIndex = 0;

function getVoiceForAction(action: any): string {
  // Try to match agentId to a Sarvam voice
  const agentId = action.agentId || action.speakerId || '';
  if (agentId && SARVAM_VOICE_MAP[agentId]) {
    return SARVAM_VOICE_MAP[agentId];
  }
  // Try to match by agent name in the text or metadata
  const agentName = action.agentName || action.speaker || '';
  const nameMap: Record<string, string> = {
    'Kavitha': 'kavitha', 'Dr. Kavitha': 'kavitha',
    'Rajesh': 'rahul', 'Dr. Rajesh': 'rahul',
    'Priya': 'priya', 'Dr. Priya': 'priya',
    'Arun': 'amit', 'Dr. Arun': 'amit',
    'Meera': 'shreya', 'Dr. Meera': 'shreya',
    'Ananya': 'kavya',
    'Vikram': 'varun',
    'Fatima': 'simran',
    'Deepak': 'dev',
  };
  for (const [name, voice] of Object.entries(nameMap)) {
    if (agentName.includes(name)) return voice;
  }
  // No agent match — rotate through voice pool for variety
  const voice = VOICE_POOL[voiceRotationIndex % VOICE_POOL.length];
  voiceRotationIndex++;
  return voice;
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
  const speed = parseFloat(args.speed || String(DEFAULT_SPEED));

  if (!process.env.SARVAM_API_KEY) {
    console.error('SARVAM_API_KEY not set in .env.local');
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

  console.log(`\nTTS: Sarvam AI Bulbul v3 | speed=${speed}x | per-agent voice mapping`);

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
    const speechActions: Array<{ sceneTitle: string; actionId: string; text: string; agentId?: string; agentName?: string }> = [];
    for (const scene of scenes) {
      const actions = scene.actions || [];
      for (const action of actions) {
        if (action.type === 'speech' && action.text) {
          const audioId = action.id || action.audioId || `tts_${action.id}`;
          speechActions.push({
            sceneTitle: scene.title || 'Untitled',
            actionId: audioId,
            text: action.text,
            agentId: action.agentId,
            agentName: action.agentName || action.speaker,
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

      const agentVoice = getVoiceForAction(speechActions[i]);
      process.stdout.write(`  [${i + 1}/${speechActions.length}] "${sceneTitle}" [${agentVoice}] (${text.length} chars)... `);

      try {
        const { base64, format } = await generateTTSViaSarvam(text, agentVoice, speed);
        await saveAudio(actionId, classroomId, base64, format);
        totalRendered++;
        console.log(`done (${Math.round(base64.length / 1024)}KB)`);
        // Rate limit: small delay between Sarvam API calls
        await new Promise(r => setTimeout(r, 300));
      } catch (err) {
        totalErrors++;
        const msg = err instanceof Error ? err.message : String(err);
        console.log(`FAILED: ${msg}`);
        // If rate limited, wait longer and retry once
        if (msg.includes('429') || msg.includes('rate') || msg.includes('Too Many')) {
          console.log('    Rate limited — waiting 10s...');
          await new Promise(r => setTimeout(r, 10000));
        }
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

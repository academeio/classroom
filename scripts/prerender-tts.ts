/**
 * Pre-render TTS audio for EXISTING classrooms (back-fill).
 *
 * Fetches a classroom from Neon, renders TTS for every speech action via the
 * pluggable TTS dispatcher (Kokoro local by default, or Sarvam), uploads each
 * clip to R2, writes an audio manifest, and — crucially — stamps the audioId
 * onto each speech action and the manifestUrl onto the classroom record so the
 * player's R2 preload path (lib/utils/audio-preloader → preloadFromManifest)
 * can stream it.
 *
 * This is the back-fill counterpart to the TTS step in
 * scripts/generate-classroom.ts (which does the same for freshly-generated
 * classrooms). Use it for classrooms created before the R2 audio pipeline.
 *
 * Usage:
 *   npx tsx scripts/prerender-tts.ts --classroom DCLxkHLZl7 --tts kokoro
 *   npx tsx scripts/prerender-tts.ts --all-pilots --tts kokoro
 *   npx tsx scripts/prerender-tts.ts --classroom DCLxkHLZl7 --tts sarvam --speed 1.0
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(__dirname, '..', '.env.local') });

import { neon } from '@neondatabase/serverless';
import { uploadClassroomAudio, uploadAudioManifest } from '../lib/storage/r2-client';
import { SARVAM_VOICE_MAP } from '../lib/orchestration/registry/medical-agents';
import { getSynthesizer, pickVoicePair, isValidProvider, type TTSProviderId } from '../lib/tts';

const DEFAULT_SPEED = 1.0;

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

// ── Per-classroom voice selection ──
// Agent-name → voice mapping only applies to Sarvam (the map is Sarvam-specific).
// For Kokoro every action alternates between the chosen [female, male] pair.
let classroomVoicePair: [string, string] = ['kavitha', 'rahul'];
let voiceAlternateIndex = 0;
let activeProvider: TTSProviderId = 'kokoro';

function getVoiceForAction(action: Record<string, unknown>): string {
  if (activeProvider === 'sarvam') {
    const agentId = (action.agentId || action.speakerId || '') as string;
    if (agentId && SARVAM_VOICE_MAP[agentId]) return SARVAM_VOICE_MAP[agentId];
    const agentName = (action.agentName || action.speaker || '') as string;
    const nameMap: Record<string, string> = {
      Kavitha: 'kavitha', 'Dr. Kavitha': 'kavitha',
      Rajesh: 'rahul', 'Dr. Rajesh': 'rahul',
      Priya: 'priya', 'Dr. Priya': 'priya',
      Arun: 'amit', 'Dr. Arun': 'amit',
      Meera: 'shreya', 'Dr. Meera': 'shreya',
      Ananya: 'kavya', Vikram: 'varun', Fatima: 'simran', Deepak: 'dev',
    };
    for (const [name, voice] of Object.entries(nameMap)) {
      if (agentName.includes(name)) return voice;
    }
  }
  const voice = classroomVoicePair[voiceAlternateIndex % 2];
  voiceAlternateIndex++;
  return voice;
}

async function main() {
  const args = parseArgs();
  const speed = parseFloat(args.speed || String(DEFAULT_SPEED));
  const ttsRaw = (args.tts || 'kokoro').toLowerCase();
  if (!isValidProvider(ttsRaw)) {
    console.error(`Unknown --tts value "${ttsRaw}". Use "kokoro" or "sarvam".`);
    process.exit(1);
  }
  activeProvider = ttsRaw;
  const synthesize = getSynthesizer(activeProvider);

  const sql = neon(process.env.DATABASE_URL!);

  let classroomIds: string[] = [];
  if (args['all-pilots']) {
    const rows = await sql`SELECT id, title FROM classrooms WHERE is_pilot = true ORDER BY created_at`;
    classroomIds = rows.map((r: Record<string, unknown>) => r.id as string);
    console.log(`Found ${classroomIds.length} pilot classrooms`);
  } else if (args.classroom) {
    classroomIds = [args.classroom];
  } else {
    console.error('Usage: npx tsx scripts/prerender-tts.ts --classroom <id> [--tts kokoro|sarvam]');
    console.error('       npx tsx scripts/prerender-tts.ts --all-pilots --tts kokoro');
    process.exit(1);
  }

  console.log(`\nTTS provider: ${activeProvider} | speed=${speed}x`);

  let grandRendered = 0;
  let grandErrors = 0;
  let grandChars = 0;

  for (const classroomId of classroomIds) {
    classroomVoicePair = pickVoicePair(activeProvider);
    voiceAlternateIndex = 0;

    console.log(`\n${'='.repeat(60)}`);
    console.log(`Processing: ${classroomId}`);
    console.log(`  Voices: ${classroomVoicePair[0]} (F) + ${classroomVoicePair[1]} (M)`);

    const rows = await sql`SELECT classroom_data, title FROM classrooms WHERE id = ${classroomId}`;
    if (rows.length === 0) {
      console.log('  NOT FOUND — skipping');
      continue;
    }
    const data = typeof rows[0].classroom_data === 'string'
      ? JSON.parse(rows[0].classroom_data as string)
      : rows[0].classroom_data;
    console.log(`  Title: ${rows[0].title}`);

    const scenes = data.scenes || [];
    console.log(`  Scenes: ${scenes.length}`);

    const audioManifestEntries: Array<{ audioId: string; url: string }> = [];
    let rendered = 0;
    let errors = 0;
    let chars = 0;

    // Iterate the ACTUAL scene actions so we can stamp audioId in place.
    for (const scene of scenes) {
      const actions = scene.actions || [];
      for (const action of actions) {
        if (action.type !== 'speech' || !action.text) continue;

        // Stable audioId: reuse action.id (mirrors generate-classroom.ts).
        const audioId = (action.id || action.audioId) as string | undefined;
        if (!audioId) continue;
        action.audioId = audioId; // stamp for the player + preloader

        const text = action.text as string;
        const voice = getVoiceForAction(action);
        process.stdout.write(`  "${audioId}" [${voice}] (${text.length} chars)... `);
        try {
          const { buffer, format } = await synthesize({ text, voice, pace: speed });
          const url = await uploadClassroomAudio(classroomId, audioId, buffer, format);
          audioManifestEntries.push({ audioId, url });
          rendered++;
          chars += text.length;
          console.log(`done (${Math.round(buffer.length / 1024)}KB) → R2`);
        } catch (err) {
          errors++;
          console.log(`FAILED: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }

    if (audioManifestEntries.length === 0) {
      console.log('  No audio rendered — leaving classroom unchanged.');
      continue;
    }

    // Upload manifest + persist manifestUrl and the audioId-stamped scenes.
    const manifestUrl = await uploadAudioManifest(classroomId, audioManifestEntries);
    data.manifestUrl = manifestUrl;
    await sql`UPDATE classrooms SET classroom_data = ${JSON.stringify(data)} WHERE id = ${classroomId}`;
    console.log(`  Manifest: ${manifestUrl}`);
    console.log(`  Stamped ${audioManifestEntries.length} audioIds + manifestUrl into classroom_data`);

    grandRendered += rendered;
    grandErrors += errors;
    grandChars += chars;
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log('TTS Pre-rendering Complete');
  console.log(`  Provider:   ${activeProvider}`);
  console.log(`  Rendered:   ${grandRendered}`);
  console.log(`  Characters: ${grandChars.toLocaleString()}`);
  console.log(`  Errors:     ${grandErrors}`);
  console.log('='.repeat(60));
}

main().catch((err) => {
  console.error('Fatal error:', err instanceof Error ? err.message : err);
  process.exit(1);
});

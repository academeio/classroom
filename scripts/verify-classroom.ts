/**
 * Verify classroom quality — checks that content and audio are ready.
 *
 * Usage:
 *   npx tsx scripts/verify-classroom.ts --classroom SUL3I0IaHJ
 *   npx tsx scripts/verify-classroom.ts --all-pilots
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(__dirname, '..', '.env.local') });

import { neon } from '@neondatabase/serverless';
import { getClassroomAudio } from '../lib/storage/neon-audio-store';

async function main() {
  const args = process.argv.slice(2);
  const parsed: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--') && i + 1 < args.length && !args[i + 1].startsWith('--')) {
      parsed[args[i].slice(2)] = args[++i];
    } else if (args[i] === '--all-pilots') {
      parsed['all-pilots'] = 'true';
    }
  }

  const sql = neon(process.env.DATABASE_URL!);

  let classroomIds: string[] = [];
  if (parsed['all-pilots']) {
    const rows = await sql`SELECT id FROM classrooms WHERE is_pilot = true ORDER BY created_at`;
    classroomIds = rows.map((r: any) => r.id);
  } else if (parsed.classroom) {
    classroomIds = [parsed.classroom];
  } else {
    // All classrooms
    const rows = await sql`SELECT id FROM classrooms ORDER BY created_at`;
    classroomIds = rows.map((r: any) => r.id);
  }

  console.log(`Verifying ${classroomIds.length} classroom(s)...\n`);

  let allPass = true;

  for (const id of classroomIds) {
    const rows = await sql`SELECT id, title, classroom_data FROM classrooms WHERE id = ${id}`;
    if (rows.length === 0) {
      console.log(`[${id}] NOT FOUND`);
      allPass = false;
      continue;
    }

    const { title, classroom_data } = rows[0];
    const data = typeof classroom_data === 'string' ? JSON.parse(classroom_data) : classroom_data;
    const scenes = data.scenes || [];

    // Count speech actions with IDs
    const speechActions = scenes.flatMap((s: any) =>
      (s.actions || []).filter((a: any) => a.type === 'speech' && a.id),
    );

    // Count pre-rendered audio
    const audioFiles = await getClassroomAudio(id);
    const audioIds = new Set(audioFiles.map((a: any) => a.audioId));

    // Check coverage
    const matched = speechActions.filter((a: any) => audioIds.has(a.id)).length;
    const coverage = speechActions.length > 0 ? Math.round((matched / speechActions.length) * 100) : 100;
    const pass = coverage >= 90;

    if (!pass) allPass = false;

    console.log(
      `[${id}] ${title}` +
        `\n  Scenes: ${scenes.length}` +
        `\n  Speech actions: ${speechActions.length}` +
        `\n  Pre-rendered audio: ${audioFiles.length}` +
        `\n  Matched: ${matched}/${speechActions.length} (${coverage}%)` +
        `\n  Status: ${pass ? 'PASS' : 'FAIL — needs TTS pre-rendering'}` +
        `\n`,
    );
  }

  console.log('='.repeat(50));
  console.log(`Overall: ${allPass ? 'ALL PASS' : 'SOME FAILED — run prerender-tts.ts for failing classrooms'}`);
  process.exit(allPass ? 0 : 2);
}

main().catch((err) => {
  console.error('Error:', err instanceof Error ? err.message : err);
  process.exit(1);
});

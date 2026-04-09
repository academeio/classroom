/**
 * Edit classroom scenes in Neon — replace, add, remove, or reorder scenes.
 *
 * Usage:
 *   # List all scenes in a classroom
 *   npx tsx scripts/edit-classroom.ts --classroom 9V-zCorw6a --list
 *
 *   # Replace a scene's interactive HTML
 *   npx tsx scripts/edit-classroom.ts --classroom 9V-zCorw6a --scene 3 --replace-html ./better-widget.html
 *
 *   # Replace a scene's slide content (JSON file with elements + background)
 *   npx tsx scripts/edit-classroom.ts --classroom 9V-zCorw6a --scene 2 --replace-slide ./new-slide.json
 *
 *   # Replace a scene's speech text (for TTS re-rendering)
 *   npx tsx scripts/edit-classroom.ts --classroom 9V-zCorw6a --scene 1 --action 3 --replace-speech "New speech text here"
 *
 *   # Add a new scene from a JSON file (inserted after --after position)
 *   npx tsx scripts/edit-classroom.ts --classroom 9V-zCorw6a --add-scene ./new-scene.json --after 2
 *
 *   # Remove a scene
 *   npx tsx scripts/edit-classroom.ts --classroom 9V-zCorw6a --remove-scene 5
 *
 *   # Export a scene to JSON (for editing externally)
 *   npx tsx scripts/edit-classroom.ts --classroom 9V-zCorw6a --scene 3 --export ./scene3.json
 *
 *   # Import an edited scene back
 *   npx tsx scripts/edit-classroom.ts --classroom 9V-zCorw6a --scene 3 --import ./scene3-edited.json
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(__dirname, '..', '.env.local') });

import { readFileSync, writeFileSync } from 'fs';
import { neon } from '@neondatabase/serverless';

// ── Args ──

function parseArgs() {
  const args = process.argv.slice(2);
  const parsed: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--list') {
      parsed.list = 'true';
    } else if (args[i].startsWith('--') && i + 1 < args.length && !args[i + 1].startsWith('--')) {
      parsed[args[i].slice(2)] = args[++i];
    }
  }
  return parsed;
}

// ── Helpers ──

async function getClassroomData(sql: any, classroomId: string) {
  const rows = await sql`SELECT id, title, classroom_data FROM classrooms WHERE id = ${classroomId}`;
  if (rows.length === 0) throw new Error(`Classroom ${classroomId} not found`);
  const data = typeof rows[0].classroom_data === 'string'
    ? JSON.parse(rows[0].classroom_data)
    : rows[0].classroom_data;
  return { title: rows[0].title, data };
}

async function saveClassroomData(sql: any, classroomId: string, data: any) {
  await sql`UPDATE classrooms SET classroom_data = ${JSON.stringify(data)}::jsonb WHERE id = ${classroomId}`;
}

// ── Main ──

async function main() {
  const args = parseArgs();

  if (!args.classroom) {
    console.error(`Usage: npx tsx scripts/edit-classroom.ts --classroom <id> --list
       npx tsx scripts/edit-classroom.ts --classroom <id> --scene <n> --export ./out.json
       npx tsx scripts/edit-classroom.ts --classroom <id> --scene <n> --import ./edited.json
       npx tsx scripts/edit-classroom.ts --classroom <id> --scene <n> --replace-html ./file.html
       npx tsx scripts/edit-classroom.ts --classroom <id> --scene <n> --replace-slide ./slide.json
       npx tsx scripts/edit-classroom.ts --classroom <id> --scene <n> --action <n> --replace-speech "text"
       npx tsx scripts/edit-classroom.ts --classroom <id> --add-scene ./scene.json --after <n>
       npx tsx scripts/edit-classroom.ts --classroom <id> --remove-scene <n>`);
    process.exit(1);
  }

  const sql = neon(process.env.DATABASE_URL!);
  const { title, data } = await getClassroomData(sql, args.classroom);
  const scenes = data.scenes || [];

  console.log(`Classroom: ${args.classroom} — "${title}" (${scenes.length} scenes)\n`);

  // ── List ──
  if (args.list) {
    scenes.forEach((s: any, i: number) => {
      const elements = s.content?.canvas?.elements || [];
      const actions = s.actions || [];
      const speeches = actions.filter((a: any) => a.type === 'speech').length;
      const images = elements.filter((e: any) => e.type === 'image').length;
      console.log(
        `  ${i + 1}. [${s.type}] "${s.title}"` +
        `  — ${elements.length} elements, ${images} images, ${speeches} speeches, ${actions.length} actions`,
      );
    });
    return;
  }

  // ── Export ──
  if (args.scene && args.export) {
    const idx = parseInt(args.scene) - 1;
    if (idx < 0 || idx >= scenes.length) throw new Error(`Scene ${args.scene} out of range (1-${scenes.length})`);
    const scene = scenes[idx];
    writeFileSync(args.export, JSON.stringify(scene, null, 2));
    console.log(`Exported scene ${args.scene} ("${scene.title}") to ${args.export}`);
    return;
  }

  // ── Import ──
  if (args.scene && args.import) {
    const idx = parseInt(args.scene) - 1;
    if (idx < 0 || idx >= scenes.length) throw new Error(`Scene ${args.scene} out of range (1-${scenes.length})`);
    const newScene = JSON.parse(readFileSync(args.import, 'utf-8'));
    // Preserve id and order from original
    newScene.id = scenes[idx].id;
    newScene.order = scenes[idx].order;
    scenes[idx] = newScene;
    await saveClassroomData(sql, args.classroom, data);
    console.log(`Imported scene ${args.scene} from ${args.import} — saved to Neon`);
    return;
  }

  // ── Replace interactive HTML ──
  if (args.scene && args['replace-html']) {
    const idx = parseInt(args.scene) - 1;
    if (idx < 0 || idx >= scenes.length) throw new Error(`Scene ${args.scene} out of range`);
    const scene = scenes[idx];
    if (scene.type !== 'interactive') {
      console.warn(`Warning: Scene ${args.scene} is type "${scene.type}", not "interactive". Replacing content anyway.`);
    }
    const html = readFileSync(args['replace-html'], 'utf-8');
    if (!scene.content) scene.content = {};
    scene.content.type = 'html';
    scene.content.html = html;
    scenes[idx] = scene;
    await saveClassroomData(sql, args.classroom, data);
    console.log(`Replaced HTML for scene ${args.scene} ("${scene.title}") — ${html.length} chars — saved to Neon`);
    return;
  }

  // ── Replace slide content ──
  if (args.scene && args['replace-slide']) {
    const idx = parseInt(args.scene) - 1;
    if (idx < 0 || idx >= scenes.length) throw new Error(`Scene ${args.scene} out of range`);
    const slideContent = JSON.parse(readFileSync(args['replace-slide'], 'utf-8'));
    const scene = scenes[idx];
    if (!scene.content) scene.content = {};
    scene.content.canvas = slideContent;
    scenes[idx] = scene;
    await saveClassroomData(sql, args.classroom, data);
    const elCount = slideContent.elements?.length || 0;
    console.log(`Replaced slide content for scene ${args.scene} ("${scene.title}") — ${elCount} elements — saved to Neon`);
    return;
  }

  // ── Replace speech text ──
  if (args.scene && args.action && args['replace-speech']) {
    const sceneIdx = parseInt(args.scene) - 1;
    const actionIdx = parseInt(args.action) - 1;
    if (sceneIdx < 0 || sceneIdx >= scenes.length) throw new Error(`Scene ${args.scene} out of range`);
    const actions = scenes[sceneIdx].actions || [];
    if (actionIdx < 0 || actionIdx >= actions.length) throw new Error(`Action ${args.action} out of range (1-${actions.length})`);
    if (actions[actionIdx].type !== 'speech') {
      throw new Error(`Action ${args.action} is type "${actions[actionIdx].type}", not "speech"`);
    }
    const oldText = actions[actionIdx].text;
    actions[actionIdx].text = args['replace-speech'];
    scenes[sceneIdx].actions = actions;
    await saveClassroomData(sql, args.classroom, data);
    console.log(`Replaced speech text for scene ${args.scene}, action ${args.action}`);
    console.log(`  Old: "${oldText.substring(0, 80)}..."`);
    console.log(`  New: "${args['replace-speech'].substring(0, 80)}..."`);
    console.log(`Note: Run prerender-tts.ts to update the audio for this speech action.`);
    return;
  }

  // ── Add scene ──
  if (args['add-scene']) {
    const newScene = JSON.parse(readFileSync(args['add-scene'], 'utf-8'));
    const afterIdx = args.after ? parseInt(args.after) : scenes.length;
    // Generate ID if missing
    if (!newScene.id) newScene.id = `custom_${Date.now()}`;
    // Insert at position
    scenes.splice(afterIdx, 0, newScene);
    // Reorder
    scenes.forEach((s: any, i: number) => { s.order = i + 1; });
    data.scenes = scenes;
    await saveClassroomData(sql, args.classroom, data);
    console.log(`Added scene "${newScene.title || 'Untitled'}" after position ${afterIdx} — now ${scenes.length} scenes — saved to Neon`);
    return;
  }

  // ── Remove scene ──
  if (args['remove-scene']) {
    const idx = parseInt(args['remove-scene']) - 1;
    if (idx < 0 || idx >= scenes.length) throw new Error(`Scene ${args['remove-scene']} out of range`);
    const removed = scenes.splice(idx, 1)[0];
    scenes.forEach((s: any, i: number) => { s.order = i + 1; });
    data.scenes = scenes;
    await saveClassroomData(sql, args.classroom, data);
    console.log(`Removed scene ${args['remove-scene']} ("${removed.title}") — now ${scenes.length} scenes — saved to Neon`);
    // Also clean up audio for removed scene
    const removedAudioIds = (removed.actions || []).filter((a: any) => a.type === 'speech').map((a: any) => a.id);
    if (removedAudioIds.length > 0) {
      console.log(`  Note: ${removedAudioIds.length} speech actions had audio. Run prerender-tts to clean up.`);
    }
    return;
  }

  console.error('No action specified. Use --list, --export, --import, --replace-html, --replace-slide, --add-scene, or --remove-scene');
  process.exit(1);
}

main().catch((err) => {
  console.error('Error:', err instanceof Error ? err.message : err);
  process.exit(1);
});

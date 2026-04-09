/**
 * Programmatic Classroom Generation Script
 *
 * Calls the step-by-step generation APIs (outlines -> content -> actions)
 * to create a classroom from CLI arguments, bypassing Vercel serverless limits.
 * Saves the resulting classroom directly to Neon.
 *
 * Usage:
 *   npx tsx scripts/generate-classroom.ts \
 *     --base-url "https://classroom.cbme.in" \
 *     --password "academe-classroom-2026" \
 *     --topic "Brachial Plexus" \
 *     --requirement "Interactive classroom on the Brachial Plexus..." \
 *     --competencies "AN10.3,AN10.5"
 *
 * Environment variables (from .env.local):
 *   DATABASE_URL — Neon connection string (for saving classroom)
 */

import { config } from 'dotenv';
import { resolve } from 'path';

// Load .env.local from project root
config({ path: resolve(__dirname, '..', '.env.local') });

import { nanoid } from 'nanoid';
import { saveClassroom } from '../lib/storage/neon-classroom-store';
import { saveAudio, getClassroomAudio } from '../lib/storage/neon-audio-store';
import { saveImage } from '../lib/storage/neon-image-store';
import sharp from 'sharp';
import { fallbackToExistingImage } from '../lib/media/adapters/gemini-medical-fallback';
import { SARVAM_VOICE_MAP } from '../lib/orchestration/registry/medical-agents';

// ── Sarvam TTS with 2-voice alternating ──

const MALE_VOICES = ['rahul', 'amit', 'dev', 'varun'];
const FEMALE_VOICES = ['kavitha', 'priya', 'kavya', 'shreya', 'simran'];

let classroomVoicePair: [string, string] = ['kavitha', 'rahul'];
let voiceAlternateIndex = 0;

function pickVoicePair(): [string, string] {
  const male = MALE_VOICES[Math.floor(Math.random() * MALE_VOICES.length)];
  const female = FEMALE_VOICES[Math.floor(Math.random() * FEMALE_VOICES.length)];
  return [female, male];
}

function getVoiceForAction(action: Record<string, unknown>): string {
  const agentId = (action.agentId || action.speakerId || '') as string;
  if (agentId && SARVAM_VOICE_MAP[agentId]) return SARVAM_VOICE_MAP[agentId];

  const agentName = (action.agentName || action.speaker || '') as string;
  const nameMap: Record<string, string> = {
    'Kavitha': 'kavitha', 'Dr. Kavitha': 'kavitha',
    'Rajesh': 'rahul', 'Dr. Rajesh': 'rahul',
    'Priya': 'priya', 'Dr. Priya': 'priya',
    'Arun': 'amit', 'Dr. Arun': 'amit',
    'Meera': 'shreya', 'Dr. Meera': 'shreya',
    'Ananya': 'kavya', 'Vikram': 'varun',
    'Fatima': 'simran', 'Deepak': 'dev',
  };
  for (const [name, voice] of Object.entries(nameMap)) {
    if (agentName.includes(name)) return voice;
  }
  // No agent match — alternate between the 2 selected voices
  const voice = classroomVoicePair[voiceAlternateIndex % 2];
  voiceAlternateIndex++;
  return voice;
}

async function generateTTSViaSarvam(
  text: string,
  voice: string,
  pace: number = 1.0,
): Promise<{ base64: string; format: string }> {
  const apiKey = process.env.SARVAM_API_KEY;
  if (!apiKey) throw new Error('SARVAM_API_KEY not set in .env.local');

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

// ── Types ──

interface SceneOutline {
  id: string;
  type: 'slide' | 'quiz' | 'interactive' | 'pbl';
  title: string;
  description: string;
  keyPoints: string[];
  order: number;
  language?: string;
  [key: string]: unknown;
}

interface CliArgs {
  topic: string;
  requirement: string;
  competencies?: string;
  baseUrl: string;
  password: string;
  model?: string;
}

// ── Argument parsing ──

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  const parsed: Record<string, string> = {};

  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--') && i + 1 < args.length) {
      const key = args[i].slice(2);
      parsed[key] = args[++i];
    }
  }

  if (!parsed.topic || !parsed.requirement || !parsed.password) {
    console.error(`
Usage:
  npx tsx scripts/generate-classroom.ts \\
    --base-url "https://classroom.cbme.in" \\
    --password "your-password" \\
    --topic "Brachial Plexus" \\
    --requirement "Full description of the classroom..." \\
    --competencies "AN10.3,AN10.5" \\
    --model "anthropic:claude-sonnet-4-latest"

Required: --topic, --requirement, --password
Optional: --base-url (default: http://localhost:3000), --competencies, --model
`);
    process.exit(1);
  }

  return {
    topic: parsed.topic,
    requirement: parsed.requirement,
    competencies: parsed.competencies,
    baseUrl: (parsed['base-url'] || 'http://localhost:3000').replace(/\/$/, ''),
    password: parsed.password,
    model: parsed.model,
  };
}

// ── HTTP helpers ──

let sessionCookie = '';

async function apiFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> || {}),
  };

  if (sessionCookie) {
    headers['Cookie'] = sessionCookie;
  }

  return fetch(url, { ...options, headers });
}

async function apiJson<T = any>(url: string, options: RequestInit = {}): Promise<T> {
  const resp = await apiFetch(url, options);
  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw new Error(`HTTP ${resp.status} from ${url}: ${body}`);
  }
  return resp.json() as Promise<T>;
}

function getModelHeaders(model?: string): Record<string, string> {
  const modelString = model || process.env.DEFAULT_MODEL || 'anthropic:claude-sonnet-4-latest';
  return {
    'x-model': modelString,
    'x-image-generation-enabled': 'true',
    'x-video-generation-enabled': 'false',
  };
}

/**
 * Try to find a pre-existing image from cbme's capsule_images.
 * Logs result, updates generatedImages map on success.
 */
async function tryFallbackImage(
  req: { elementId: string; prompt: string },
  classroomId: string,
  baseUrl: string,
  generatedImages: Record<string, string>,
): Promise<void> {
  process.stdout.write(`    ↳ Trying fallback from cbme library... `);
  try {
    const fallback = await fallbackToExistingImage(req.prompt, req.elementId, classroomId);
    if (fallback) {
      generatedImages[req.elementId] = `${baseUrl}/api/classroom-images?imageId=${req.elementId}`;
      console.log('found & copied!');
    } else {
      console.log('no match — skipping image.');
    }
  } catch (err) {
    console.log(`fallback failed: ${err instanceof Error ? err.message : err}`);
  }
}

// ── Step 1: Authenticate ──

async function authenticate(baseUrl: string, password: string): Promise<void> {
  console.log('\n[1/7] Authenticating...');

  const resp = await fetch(`${baseUrl}/api/auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
    redirect: 'manual',
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw new Error(`Authentication failed (${resp.status}): ${body}`);
  }

  // Extract set-cookie header
  const setCookie = resp.headers.get('set-cookie');
  if (setCookie) {
    // Extract just the cookie name=value pair
    sessionCookie = setCookie.split(';')[0];
  }

  console.log('  Authenticated successfully.');
}

// ── Step 2: Enrich competencies (optional) ──

async function enrichCompetencies(
  baseUrl: string,
  codes: string[],
): Promise<{ enrichedText: string; subjectCodes: string[] }> {
  console.log(`\n[2/7] Enriching competencies: ${codes.join(', ')}...`);

  const resp = await apiJson<{
    success: boolean;
    data?: Array<{
      competency_code: string;
      competency_text: string;
      domain: string;
      subject_code: string;
      subject_name: string;
      topic_name: string;
      teaching_methods?: string[];
      assessment_methods?: string[];
    }>;
    error?: string;
  }>(`${baseUrl}/api/competencies/enrich`, {
    method: 'POST',
    body: JSON.stringify({ codes }),
  });

  if (!resp.success || !resp.data || resp.data.length === 0) {
    console.warn('  No competency data found, proceeding without enrichment.');
    return { enrichedText: '', subjectCodes: [] };
  }

  const subjectCodes = [...new Set(resp.data.map((r) => r.subject_code))];

  const enrichedLines = resp.data.map(
    (c) =>
      `- ${c.competency_code}: ${c.competency_text} [${c.domain}] (${c.subject_name} > ${c.topic_name})`,
  );

  const enrichedText = `\n\nNMC 2024 Competencies to address:\n${enrichedLines.join('\n')}`;

  console.log(`  Found ${resp.data.length} competencies from ${subjectCodes.length} subject(s).`);
  return { enrichedText, subjectCodes };
}

// ── Step 3: Generate outlines (SSE) ──

async function generateOutlines(
  baseUrl: string,
  requirement: string,
  language: 'en-US' | 'zh-CN',
  model?: string,
): Promise<SceneOutline[]> {
  console.log('\n[3/7] Generating scene outlines (streaming)...');

  const resp = await apiFetch(`${baseUrl}/api/generate/scene-outlines-stream`, {
    method: 'POST',
    headers: getModelHeaders(model),
    body: JSON.stringify({
      requirements: {
        requirement,
        language,
      },
    }),
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw new Error(`Outline generation failed (${resp.status}): ${body}`);
  }

  // Parse SSE stream
  const text = await resp.text();
  const lines = text.split('\n');
  let outlines: SceneOutline[] = [];
  let doneOutlines: SceneOutline[] | null = null;

  for (const line of lines) {
    if (!line.startsWith('data: ')) continue;
    try {
      const evt = JSON.parse(line.slice(6));
      if (evt.type === 'outline') {
        outlines.push(evt.data);
        process.stdout.write(`  Outline ${outlines.length}: "${evt.data.title}" (${evt.data.type})\n`);
      } else if (evt.type === 'done') {
        doneOutlines = evt.outlines || outlines;
      } else if (evt.type === 'error') {
        throw new Error(`Outline generation error: ${evt.error}`);
      } else if (evt.type === 'retry') {
        console.log(`  Retrying (attempt ${evt.attempt}/${evt.maxAttempts})...`);
        outlines = [];
      }
    } catch (e) {
      if (e instanceof Error && e.message.startsWith('Outline generation error')) throw e;
      // Skip unparseable lines (heartbeats, etc.)
    }
  }

  const result = doneOutlines || outlines;
  if (result.length === 0) {
    throw new Error('No outlines generated');
  }

  console.log(`  Generated ${result.length} outlines.`);
  return result;
}

// ── Step 4: Generate content for each scene ──

async function generateSceneContent(
  baseUrl: string,
  outline: SceneOutline,
  allOutlines: SceneOutline[],
  stageId: string,
  stageInfo: { name: string; description: string; language: string; style: string },
  model?: string,
): Promise<{ content: any; effectiveOutline: SceneOutline }> {
  const resp = await apiJson<{
    success: boolean;
    content?: any;
    effectiveOutline?: SceneOutline;
    error?: string;
  }>(`${baseUrl}/api/generate/scene-content`, {
    method: 'POST',
    headers: getModelHeaders(model),
    body: JSON.stringify({
      outline,
      allOutlines,
      stageInfo,
      stageId,
    }),
  });

  if (!resp.success || !resp.content) {
    throw new Error(`Content generation failed for "${outline.title}": ${resp.error || 'unknown error'}`);
  }

  return { content: resp.content, effectiveOutline: resp.effectiveOutline || outline };
}

// ── Step 5: Generate actions for each scene ──

async function generateSceneActions(
  baseUrl: string,
  outline: SceneOutline,
  allOutlines: SceneOutline[],
  content: any,
  stageId: string,
  previousSpeeches: string[],
  model?: string,
): Promise<{ scene: any; previousSpeeches: string[] }> {
  const resp = await apiJson<{
    success: boolean;
    scene?: any;
    previousSpeeches?: string[];
    error?: string;
  }>(`${baseUrl}/api/generate/scene-actions`, {
    method: 'POST',
    headers: getModelHeaders(model),
    body: JSON.stringify({
      outline,
      allOutlines,
      content,
      stageId,
      previousSpeeches,
    }),
  });

  if (!resp.success || !resp.scene) {
    throw new Error(`Action generation failed for "${outline.title}": ${resp.error || 'unknown error'}`);
  }

  return {
    scene: resp.scene,
    previousSpeeches: resp.previousSpeeches || [],
  };
}

// ── Main ──

async function main() {
  const args = parseArgs();

  console.log('=== Classroom Generation Script ===');
  console.log(`  Topic: ${args.topic}`);
  console.log(`  Server: ${args.baseUrl}`);
  console.log(`  Model: ${args.model || process.env.DEFAULT_MODEL || 'anthropic:claude-sonnet-4-latest'}`);

  const startTime = Date.now();

  // Step 1: Authenticate
  await authenticate(args.baseUrl, args.password);

  // Step 2: Enrich competencies (optional)
  let enrichedText = '';
  let competencyCodes: string[] = [];
  let subjectCodes: string[] = [];

  if (args.competencies) {
    competencyCodes = args.competencies.split(',').map((c) => c.trim());
    const enriched = await enrichCompetencies(args.baseUrl, competencyCodes);
    enrichedText = enriched.enrichedText;
    subjectCodes = enriched.subjectCodes;
  } else {
    console.log('\n[2/7] Skipping competency enrichment (no --competencies provided).');
  }

  // Build full requirement text
  const fullRequirement = args.requirement + enrichedText;

  // Step 3: Generate outlines
  const outlines = await generateOutlines(args.baseUrl, fullRequirement, 'en-US', args.model);

  // Create stage
  const stageId = nanoid(10);
  const stage = {
    id: stageId,
    name: args.topic,
    description: '',
    language: 'en-US',
    style: 'professional',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  const stageInfo = {
    name: stage.name,
    description: stage.description,
    language: stage.language,
    style: stage.style,
  };

  // Step 3b: Generate images for outlines that have mediaGenerations
  const mediaRequests = outlines.flatMap(
    (o: any) => (o.mediaGenerations || []).filter((m: any) => m.type === 'image'),
  );

  const generatedImages: Record<string, string> = {}; // elementId → serving URL

  if (mediaRequests.length > 0) {
    console.log(`\n[3b/7] Generating ${mediaRequests.length} medical diagram(s) via Gemini Medical...`);
    for (let i = 0; i < mediaRequests.length; i++) {
      const req = mediaRequests[i];
      process.stdout.write(`  [${i + 1}/${mediaRequests.length}] "${req.elementId}" ... `);
      try {
        const resp = await apiFetch(`${args.baseUrl}/api/generate/image`, {
          method: 'POST',
          headers: {
            ...getModelHeaders(args.model),
            'x-image-provider': 'gemini-medical',
          },
          body: JSON.stringify({
            prompt: req.prompt,
            aspectRatio: req.aspectRatio || '16:9',
            style: req.style,
          }),
        });
        if (resp.ok) {
          const imgData = await resp.json();
          if (imgData.success && imgData.result?.base64) {
            // Compress: resize to max 800px wide, convert to JPEG quality 80
            const rawBuffer = Buffer.from(imgData.result.base64, 'base64');
            const compressed = await sharp(rawBuffer)
              .resize(800, null, { withoutEnlargement: true })
              .jpeg({ quality: 80 })
              .toBuffer();
            const compressedBase64 = compressed.toString('base64');
            const originalKB = Math.round(rawBuffer.length / 1024);
            const compressedKB = Math.round(compressed.length / 1024);

            await saveImage(req.elementId, stageId, compressedBase64, 'image/jpeg');
            generatedImages[req.elementId] = `${args.baseUrl}/api/classroom-images?imageId=${req.elementId}`;
            console.log(`done (${originalKB}KB → ${compressedKB}KB compressed)`);
          } else {
            console.log(`generation skipped: ${imgData.error || 'no result'}`);
            // Fallback: try pre-existing image from cbme
            await tryFallbackImage(req, stageId, args.baseUrl, generatedImages);
          }
        } else {
          const errBody = await resp.text().catch(() => '');
          console.log(`generation failed (${resp.status}): ${errBody.substring(0, 100)}`);
          // Fallback: try pre-existing image from cbme
          await tryFallbackImage(req, stageId, args.baseUrl, generatedImages);
        }
      } catch (err) {
        console.log(`error: ${err instanceof Error ? err.message : err}`);
        // Fallback: try pre-existing image from cbme
        await tryFallbackImage(req, stageId, args.baseUrl, generatedImages);
      }
    }
    console.log(`  Generated ${Object.keys(generatedImages).length}/${mediaRequests.length} images.`);
  } else {
    console.log('\n[3b/7] No image generation requests in outlines.');
  }

  // Step 4: Generate content for each scene
  console.log(`\n[4/7] Generating scene content (${outlines.length} scenes)...`);
  const sceneContents: Array<{ content: any; effectiveOutline: SceneOutline }> = [];
  const errors: string[] = [];

  for (let i = 0; i < outlines.length; i++) {
    const outline = outlines[i];
    process.stdout.write(`  [${i + 1}/${outlines.length}] "${outline.title}" (${outline.type})... `);
    try {
      const result = await generateSceneContent(
        args.baseUrl,
        outline,
        outlines,
        stageId,
        stageInfo,
        args.model,
      );
      sceneContents.push(result);
      console.log('done');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`FAILED: ${msg}`);
      errors.push(`Content[${outline.title}]: ${msg}`);
      // Push null placeholder so indices stay aligned
      sceneContents.push({ content: null, effectiveOutline: outline });
    }
  }

  // Step 5: Generate actions for each scene
  console.log(`\n[5/7] Generating scene actions...`);
  const scenes: any[] = [];
  let previousSpeeches: string[] = [];

  for (let i = 0; i < sceneContents.length; i++) {
    const { content, effectiveOutline } = sceneContents[i];
    if (!content) {
      console.log(`  [${i + 1}/${sceneContents.length}] Skipping "${effectiveOutline.title}" (no content).`);
      continue;
    }

    process.stdout.write(`  [${i + 1}/${sceneContents.length}] "${effectiveOutline.title}"... `);
    try {
      const result = await generateSceneActions(
        args.baseUrl,
        effectiveOutline,
        outlines,
        content,
        stageId,
        previousSpeeches,
        args.model,
      );
      scenes.push(result.scene);
      previousSpeeches = [...previousSpeeches, ...result.previousSpeeches];
      console.log(`done (${result.scene.actions?.length ?? 0} actions)`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`FAILED: ${msg}`);
      errors.push(`Actions[${effectiveOutline.title}]: ${msg}`);
    }
  }

  if (scenes.length === 0) {
    console.error('\nNo scenes were generated successfully. Aborting.');
    process.exit(1);
  }

  // Step 6: Pre-render TTS audio via Sarvam AI (2 alternating voices per classroom)
  const classroomId = nanoid(10);
  classroomVoicePair = pickVoicePair();
  voiceAlternateIndex = 0;
  console.log(`\n[6/7] Pre-rendering TTS audio via Sarvam AI...`);
  console.log(`  Voices: ${classroomVoicePair[0]} (F) + ${classroomVoicePair[1]} (M)`);

  let ttsCount = 0;
  let ttsErrors = 0;
  let ttsChars = 0;

  for (const scene of scenes) {
    const speechActions = (scene.actions || []).filter(
      (a: Record<string, unknown>) => a.type === 'speech' && a.text,
    );
    for (const action of speechActions) {
      // Use action.id as audioId (same as prerender-tts.ts), assign it back for preloader
      const audioId = (action.id || action.audioId) as string | undefined;
      if (!audioId) continue;
      action.audioId = audioId;

      const text = action.text as string;
      const voice = getVoiceForAction(action);
      process.stdout.write(`  TTS "${audioId}" [${voice}] (${text.length} chars)... `);
      try {
        const { base64, format } = await generateTTSViaSarvam(text, voice);
        await saveAudio(audioId, classroomId, base64, format);
        ttsCount++;
        ttsChars += text.length;
        console.log(`done (${Math.round(base64.length * 0.75 / 1024)}KB)`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.log(`FAILED: ${msg}`);
        errors.push(`TTS[${audioId}]: ${msg}`);
        ttsErrors++;
      }
    }
  }

  console.log(`  Pre-rendered ${ttsCount} audio files (${ttsErrors} errors, ${ttsChars} chars).`);

  // Replace gen_img_* placeholders with actual base64 data URLs in scene elements
  if (Object.keys(generatedImages).length > 0) {
    let replaced = 0;
    for (const scene of scenes) {
      const elements = scene.content?.canvas?.elements || scene.elements || [];
      for (const el of elements) {
        if (el.type === 'image' && el.src && generatedImages[el.src]) {
          el.src = generatedImages[el.src];
          replaced++;
        }
      }
    }
    console.log(`  Replaced ${replaced} image placeholders with generated images.`);
  }

  // Step 7: Assemble and save to Neon
  console.log(`\n[7/7] Saving classroom to Neon (${scenes.length} scenes)...`);
  const classroomData = {
    stage,
    scenes,
    outlines,
    generatedAt: new Date().toISOString(),
    generationArgs: {
      topic: args.topic,
      competencyCodes,
      model: args.model || process.env.DEFAULT_MODEL || 'anthropic:claude-sonnet-4-latest',
    },
  };

  try {
    await saveClassroom({
      id: classroomId,
      title: args.topic,
      competencyCodes,
      subjectCodes,
      data: classroomData,
      model: args.model || process.env.DEFAULT_MODEL || 'anthropic:claude-sonnet-4-latest',
      isPilot: true,
    });

    // Quality gate: verify classroom and audio are ready
    console.log('\n[QA] Running quality checks...');

    // Count speech actions
    const totalSpeechActions = scenes.reduce(
      (sum: number, s: any) => sum + (s.actions || []).filter((a: any) => a.type === 'speech' && a.id).length,
      0,
    );

    // Count pre-rendered audio
    const audioRows = await getClassroomAudio(classroomId);
    const preRenderedCount = audioRows.length;
    const audioCoverage = totalSpeechActions > 0 ? Math.round((preRenderedCount / totalSpeechActions) * 100) : 0;

    const qaPass = audioCoverage >= 90; // Allow 10% tolerance for edge cases

    console.log(`  Speech actions: ${totalSpeechActions}`);
    console.log(`  Pre-rendered audio: ${preRenderedCount}`);
    console.log(`  Audio coverage: ${audioCoverage}%`);
    console.log(`  QA status: ${qaPass ? 'PASS' : 'FAIL — audio not fully pre-rendered'}`);

    if (!qaPass && ttsErrors === 0) {
      // Audio IDs may not match — log for debugging
      const speechIds = scenes.flatMap((s: any) =>
        (s.actions || []).filter((a: any) => a.type === 'speech').map((a: any) => a.id),
      );
      const audioIds = new Set(audioRows.map((a: any) => a.audioId));
      const missing = speechIds.filter((id: string) => !audioIds.has(id));
      if (missing.length > 0) {
        console.log(`  Missing audio IDs (first 5): ${missing.slice(0, 5).join(', ')}`);
      }
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    const classroomUrl = `${args.baseUrl}/classroom/${classroomId}`;

    console.log(`\n${'='.repeat(60)}`);
    console.log(`Classroom generated ${qaPass ? 'successfully' : 'with warnings'}!`);
    console.log(`  ID:     ${classroomId}`);
    console.log(`  URL:    ${classroomUrl}`);
    console.log(`  Scenes: ${scenes.length}/${outlines.length}`);
    console.log(`  Audio:  ${preRenderedCount}/${totalSpeechActions} (${audioCoverage}%)`);
    console.log(`  Time:   ${elapsed}s`);
    console.log(`  Status: ${qaPass ? 'READY' : 'NEEDS ATTENTION — run prerender-tts.ts'}`);
    if (errors.length > 0) {
      console.log(`  Errors: ${errors.length}`);
      errors.forEach((e) => console.log(`    - ${e}`));
    }
    console.log('='.repeat(60));

    // Exit with code 2 if QA failed (distinguishes from fatal error code 1)
    if (!qaPass) {
      process.exit(2);
    }
  } catch (err) {
    console.error('\nFailed to save classroom to Neon:', err instanceof Error ? err.message : err);
    // Still output the data so it's not lost
    console.log('\nClassroom data (not saved):');
    console.log(JSON.stringify(classroomData, null, 2).slice(0, 2000) + '...');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('\nFatal error:', err instanceof Error ? err.message : err);
  process.exit(1);
});

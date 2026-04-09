/**
 * Gemini Medical Image Adapter
 *
 * Builds structured image prompts deterministically (no LLM API calls)
 * and sends them to Gemini 3.1 Flash/Pro for generation.
 *
 * Prompt construction uses rules from the cbme pipeline:
 * - Full anatomical labels with leader lines
 * - Clean digital illustration style
 * - Medical-standard color coding
 * - Complexity-based model selection (Flash vs Pro)
 *
 * Follows the same adapter interface as seedream-adapter.ts, qwen-image-adapter.ts.
 */

import type {
  ImageGenerationConfig,
  ImageGenerationOptions,
  ImageGenerationResult,
} from '../types';
import {
  GEMINI_FLASH,
  GEMINI_PRO,
  type GeminiMedicalPrompt,
} from './gemini-medical-prompts';

const DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com';

interface GeminiPart {
  text?: string;
  inlineData?: {
    mimeType: string;
    data: string;
  };
}

interface GeminiResponse {
  candidates?: Array<{
    content?: {
      parts?: GeminiPart[];
    };
  }>;
  error?: {
    code: number;
    message: string;
    status: string;
  };
}

// ── Complexity keywords for model selection ──

const COMPLEX_KEYWORDS = [
  'cross-section', 'cross section', 'pathway', 'cycle', 'mechanism',
  'comparison', 'versus', 'vs', 'stages', 'phases', 'multi-panel',
  'histology', 'microscopic', 'cellular', 'metabolic', 'cascade',
  'feedback loop', 'regulation', 'innervation', 'vascular supply',
  'lymphatic', 'embryology', 'development',
];

/**
 * Assess complexity from the raw prompt to decide Flash vs Pro.
 */
function assessComplexity(prompt: string): { complexity: 'standard' | 'complex'; reason: string } {
  const lower = prompt.toLowerCase();
  const matched = COMPLEX_KEYWORDS.filter((kw) => lower.includes(kw));
  if (matched.length >= 2) {
    return { complexity: 'complex', reason: `Multiple complex elements: ${matched.slice(0, 3).join(', ')}` };
  }
  if (matched.length === 1) {
    return { complexity: 'complex', reason: `Contains: ${matched[0]}` };
  }
  // Word count heuristic — long descriptions usually mean complex diagrams
  if (prompt.split(/\s+/).length > 40) {
    return { complexity: 'complex', reason: 'Detailed description (40+ words)' };
  }
  return { complexity: 'standard', reason: 'Simple illustration' };
}

/**
 * Build a structured Gemini prompt deterministically — no LLM API call.
 *
 * Takes the raw mediaGenerations description and wraps it in the structured
 * format that Gemini needs for medically accurate diagrams.
 */
function buildStructuredPrompt(
  rawPrompt: string,
  medicalContext?: string,
): GeminiMedicalPrompt {
  const { complexity, reason } = assessComplexity(rawPrompt);

  const contextLine = medicalContext
    ? `\n\nMedical context: ${medicalContext}`
    : '';

  const sceneDescription = [
    rawPrompt,
    '',
    'Style requirements:',
    '- Clean digital illustration with white background, medical textbook aesthetic',
    '- Include full anatomical labels directly on the diagram with leader lines/arrows',
    '- Use education-standard colors: arteries in red, veins in blue, nerves in yellow, lymph in green, bone in off-white',
    '- Labels should use clean sans-serif font with high contrast',
    '- The diagram should be self-explanatory — a student should understand it without a separate legend',
    contextLine,
  ].join('\n');

  return {
    gemini_prompt: {
      meta: {
        aspect_ratio: '16:9',
        quality: 'vector_illustration',
        guidance_scale: 15.0,
        steps: 50,
      },
      scene: {
        description: sceneDescription,
      },
      text: {
        enabled: true,
      },
      labeling: {
        strategy: 'full_labels',
        labels: [], // Gemini determines labels from the scene description
      },
      style: {
        medium: 'digital_illustration',
        aesthetic: 'minimalist',
      },
      advanced: {
        negative_prompt: ['watermark', 'signature', 'blurry', 'photorealistic', 'low quality'],
        hdr_mode: true,
      },
    },
    alt_text: rawPrompt.substring(0, 120),
    figure_title: rawPrompt.split(/[.!?]/)[0].substring(0, 80),
    layout: complexity === 'complex' ? 'Multi-panel or detailed diagram' : 'Single-panel illustration',
    complexity,
    complexity_reason: reason,
    labels: {},
  };
}

/**
 * Select the Gemini model based on complexity assessment.
 * CLI model override (via config.model) takes priority.
 */
function selectModel(
  configModel: string | undefined,
  enhanced: GeminiMedicalPrompt,
): string {
  if (configModel && configModel !== GEMINI_FLASH) {
    return configModel;
  }
  return enhanced.complexity === 'complex' ? GEMINI_PRO : GEMINI_FLASH;
}

/**
 * Call Gemini with the structured prompt.
 */
async function callGemini(
  apiKey: string,
  baseUrl: string,
  model: string,
  enhanced: GeminiMedicalPrompt,
): Promise<{ base64: string; width: number; height: number }> {
  const promptText = `Generate a medical education diagram based on this specification:\n\n${JSON.stringify(enhanced.gemini_prompt, null, 2)}`;

  const response = await fetch(`${baseUrl}/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify({
      contents: [{ parts: [{ text: promptText }] }],
      generationConfig: { responseModalities: ['IMAGE'] },
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Gemini generation failed (${response.status}): ${text}`);
  }

  const data: GeminiResponse = await response.json();

  if (data.error) {
    throw new Error(`Gemini error: ${data.error.code} - ${data.error.message}`);
  }

  const parts = data.candidates?.[0]?.content?.parts;
  if (!parts || parts.length === 0) {
    throw new Error('Gemini returned empty response');
  }

  const imagePart = parts.find((p) => p.inlineData);
  if (!imagePart?.inlineData) {
    const textPart = parts.find((p) => p.text);
    throw new Error(`Gemini did not return an image. Response: ${textPart?.text || 'none'}`);
  }

  const ratio = enhanced.gemini_prompt.meta.aspect_ratio || '16:9';
  const [w, h] = ratio.split(':').map(Number);
  const width = 1024;
  const height = Math.round((width * (h || 9)) / (w || 16));

  return {
    base64: imagePart.inlineData.data,
    width,
    height,
  };
}

/**
 * Connectivity test — validates Gemini key only (no Anthropic needed).
 */
export async function testGeminiMedicalConnectivity(
  config: ImageGenerationConfig,
): Promise<{ success: boolean; message: string }> {
  const baseUrl = config.baseUrl || DEFAULT_BASE_URL;
  try {
    const response = await fetch(`${baseUrl}/v1beta/models?key=${config.apiKey}`, {
      method: 'GET',
    });
    if (!response.ok) {
      return {
        success: false,
        message: `Gemini API key invalid (${response.status}). Check your API Key.`,
      };
    }
  } catch {
    return {
      success: false,
      message: `Cannot reach ${baseUrl}. Check network connection.`,
    };
  }

  return {
    success: true,
    message: `Connected to Gemini Medical (${GEMINI_FLASH}/${GEMINI_PRO})`,
  };
}

/**
 * Main generation function.
 *
 * Flow: Build structured prompt → select model → Gemini generation.
 * No external LLM API calls — prompt is built deterministically.
 */
export async function generateWithGeminiMedical(
  config: ImageGenerationConfig,
  options: ImageGenerationOptions,
): Promise<ImageGenerationResult> {
  const baseUrl = config.baseUrl || DEFAULT_BASE_URL;
  const medicalContext = options.style;

  try {
    // Step 1: Build structured prompt (deterministic, no API call)
    const enhanced = buildStructuredPrompt(options.prompt, medicalContext);

    console.log(
      `[gemini-medical] Complexity: ${enhanced.complexity} (${enhanced.complexity_reason}). ` +
        `Model: ${enhanced.complexity === 'complex' ? 'Pro' : 'Flash'}`,
    );

    // Step 2: Select model
    const model = selectModel(config.model, enhanced);

    // Step 3: Generate with Gemini
    const result = await callGemini(config.apiKey, baseUrl, model, enhanced);

    return {
      base64: result.base64,
      width: result.width,
      height: result.height,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[gemini-medical] Generation failed: ${message}`);
    throw err;
  }
}

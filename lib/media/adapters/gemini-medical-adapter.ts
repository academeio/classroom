/**
 * Gemini Medical Image Adapter
 *
 * Two-step generation for medically accurate diagrams:
 * 1. Claude Sonnet enhances the raw prompt into structured JSON + selects model
 * 2. Gemini generates the image using the enhanced prompt
 *
 * Falls back to pre-existing images from cbme pipeline on failure.
 *
 * Follows the same adapter interface as seedream-adapter.ts, qwen-image-adapter.ts.
 */

import type {
  ImageGenerationConfig,
  ImageGenerationOptions,
  ImageGenerationResult,
} from '../types';
import {
  PROMPT_ENHANCEMENT_SYSTEM,
  buildEnhancementUserPrompt,
  GEMINI_FLASH,
  GEMINI_PRO,
  type GeminiMedicalPrompt,
} from './gemini-medical-prompts';
import { fallbackToExistingImage } from './gemini-medical-fallback';

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

/**
 * Call Claude Sonnet to enhance a raw image prompt into structured JSON.
 * Returns the structured prompt + model selection.
 */
async function enhancePromptWithClaude(
  rawPrompt: string,
  medicalContext?: string,
): Promise<GeminiMedicalPrompt> {
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) {
    throw new Error('ANTHROPIC_API_KEY not set — required for Claude prompt enhancement');
  }

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': anthropicKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 2048,
      system: PROMPT_ENHANCEMENT_SYSTEM,
      messages: [
        {
          role: 'user',
          content: buildEnhancementUserPrompt(rawPrompt, medicalContext),
        },
      ],
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Claude prompt enhancement failed (${response.status}): ${text}`);
  }

  const data = await response.json();
  const content = data.content?.[0]?.text;
  if (!content) {
    throw new Error('Claude returned empty response for prompt enhancement');
  }

  // Parse JSON from Claude's response — strip markdown fences, leading/trailing whitespace
  let jsonStr = content.trim();
  // Remove ```json ... ``` wrapping (multiline)
  const fenceMatch = jsonStr.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (fenceMatch) {
    jsonStr = fenceMatch[1].trim();
  }
  try {
    return JSON.parse(jsonStr) as GeminiMedicalPrompt;
  } catch {
    throw new Error(`Claude returned invalid JSON: ${content.substring(0, 200)}`);
  }
}

/**
 * Select the Gemini model based on Claude's complexity assessment.
 * CLI model override (via config.model) takes priority.
 */
function selectModel(
  configModel: string | undefined,
  enhanced: GeminiMedicalPrompt,
): string {
  // Explicit model override takes priority
  if (configModel && configModel !== GEMINI_FLASH) {
    return configModel;
  }
  // Complexity-based selection
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

  // Determine dimensions from aspect ratio
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
 * Connectivity test — validates both Anthropic and Gemini keys.
 */
export async function testGeminiMedicalConnectivity(
  config: ImageGenerationConfig,
): Promise<{ success: boolean; message: string }> {
  // Check Anthropic key
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) {
    return {
      success: false,
      message: 'ANTHROPIC_API_KEY not set — required for Claude prompt enhancement.',
    };
  }

  // Check Gemini key (reuse nano-banana's model list endpoint)
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
    message: `Connected to Gemini Medical (Claude enhancement + Gemini ${GEMINI_FLASH}/${GEMINI_PRO})`,
  };
}

/**
 * Main generation function.
 *
 * Flow: Claude enhancement → model selection → Gemini generation → fallback on failure.
 *
 * The `options.prompt` contains the raw mediaGenerations description.
 * Medical context (competency, topic) can be passed via `options.style` field
 * as a workaround since ImageGenerationOptions doesn't have a context field.
 */
export async function generateWithGeminiMedical(
  config: ImageGenerationConfig,
  options: ImageGenerationOptions,
): Promise<ImageGenerationResult> {
  const baseUrl = config.baseUrl || DEFAULT_BASE_URL;
  const medicalContext = options.style; // Overloaded: style field carries medical context for this adapter

  try {
    // Step 1: Claude enhances the raw prompt
    const enhanced = await enhancePromptWithClaude(options.prompt, medicalContext);

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
    console.warn(`[gemini-medical] Generation failed: ${message}. Trying fallback...`);

    // Fallback: try pre-existing images from cbme
    // Note: fallback needs classroomId which we don't have at the adapter level.
    // The fallback is handled in generate-classroom.ts instead (see Task 6).
    // Re-throw so the caller can attempt fallback.
    throw err;
  }
}

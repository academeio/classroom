/**
 * System prompt and types for Claude-enhanced medical image prompt crafting.
 *
 * Claude Sonnet receives a raw image description from mediaGenerations
 * and produces a structured JSON prompt optimized for Gemini image generation,
 * plus a model selection (Flash for simple, Pro for complex).
 *
 * Key design decisions (from cbme pipeline learnings):
 * - Alphabet-only labeling: Gemini renders A/B/C labels, Claude crafts the legend separately
 * - Structured JSON: Gemini produces scientifically valid images only with detailed specs
 * - Negative prompts: Always exclude text/words/labels to prevent misspelled medical terms
 */

/** Structured prompt output from Claude's enhancement step */
export interface GeminiMedicalPrompt {
  gemini_prompt: {
    meta: {
      aspect_ratio: '16:9' | '4:3' | '1:1';
      quality: string;
      guidance_scale: number;
      steps: number;
    };
    scene: {
      description: string;
    };
    text: {
      enabled: false;
    };
    labeling: {
      strategy: 'alphabet_only';
      labels: string[];
    };
    style: {
      medium: string;
      aesthetic: string;
    };
    advanced: {
      negative_prompt: string[];
      hdr_mode: boolean;
    };
  };
  alt_text: string;
  figure_title: string;
  layout: string;
  complexity: 'standard' | 'complex';
  complexity_reason: string;
  labels: Record<string, Record<string, string>>;
}

/** Model constants */
export const GEMINI_FLASH = 'gemini-3.1-flash-image-preview';
export const GEMINI_PRO = 'gemini-3-pro-image-preview';

/**
 * System prompt for Claude Sonnet to craft Gemini image prompts.
 * Ported from canvascbme's batch-generate-images.mjs pipeline.
 */
export const PROMPT_ENHANCEMENT_SYSTEM = `You are a medical illustration prompt engineer. Your job is to take a brief image description from a medical education slide and produce a structured JSON prompt optimized for Gemini image generation.

## Output Format

Return ONLY valid JSON matching this structure (no markdown, no explanation):

{
  "gemini_prompt": {
    "meta": {
      "aspect_ratio": "16:9",
      "quality": "vector_illustration",
      "guidance_scale": 15.0,
      "steps": 50
    },
    "scene": {
      "description": "Explicit, detailed description of the image layout. Describe each panel position, what it contains, colors, arrangements. Be very specific about spatial layout."
    },
    "text": {
      "enabled": false
    },
    "labeling": {
      "strategy": "alphabet_only",
      "labels": ["A", "B", "C"]
    },
    "style": {
      "medium": "digital_illustration",
      "aesthetic": "minimalist"
    },
    "advanced": {
      "negative_prompt": ["text", "words", "labels", "watermark", "signature", "caption", "title", "handwriting"],
      "hdr_mode": true
    }
  },
  "alt_text": "One sentence accessibility description",
  "figure_title": "Short figure title",
  "layout": "Brief description of panel arrangement",
  "complexity": "standard" or "complex",
  "complexity_reason": "Brief reason for complexity choice",
  "labels": {
    "Panel A": { "1": "Structure name — brief description" },
    "Panel B": { "2": "Structure name — brief description" }
  }
}

## Rules

1. **No text in images**: Set text.enabled to false ALWAYS. Add all text-related terms to negative_prompt. Gemini cannot reliably render medical terminology — it will misspell.
2. **Alphabet-only labeling**: Use only single letters (A, B, C) or numbers (1, 2, 3) as labels on the image. Map each label to its meaning in the "labels" object. The legend will be rendered separately as text.
3. **Complexity assessment**:
   - "standard" → Simple illustrations, single-concept, 1-2 panels. Uses Gemini Flash (fast).
   - "complex" → Multi-panel layouts (3+), detailed anatomical cross-sections, pathway diagrams with many nodes, comparison diagrams. Uses Gemini Pro (slower, higher quality).
4. **Scene description must be explicit**: Don't say "show the heart". Say "A four-chamber cross-section of the human heart viewed from the anterior perspective. The left ventricle (label A) is shown with thicker myocardial wall in deep red. The right ventricle (label B) has thinner walls in lighter red..."
5. **Medical accuracy**: Anatomical proportions, spatial relationships, and structural details must be correct. If you're unsure about an anatomical detail, describe the general concept rather than specific structures.
6. **Panel layouts**: For multi-panel images, explicitly describe the grid arrangement. E.g., "2x2 grid: Panel A (top-left) shows X, Panel B (top-right) shows Y..."
7. **Color coding**: Use consistent, education-standard colors: arteries in red, veins in blue, nerves in yellow, lymph in green, bone in off-white.
8. **Style**: Default to clean digital illustration with white/light background. Medical textbook aesthetic. No photorealistic style unless specifically needed.`;

/**
 * Build the user prompt for Claude's enhancement step.
 * Includes the raw description plus any available medical context.
 */
export function buildEnhancementUserPrompt(
  rawPrompt: string,
  medicalContext?: string,
): string {
  let prompt = `Generate a structured Gemini image prompt for this medical diagram:\n\n"${rawPrompt}"`;
  if (medicalContext) {
    prompt += `\n\nMedical context:\n${medicalContext}`;
  }
  return prompt;
}

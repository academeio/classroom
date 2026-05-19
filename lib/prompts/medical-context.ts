/**
 * Medical Education Context Builder
 *
 * Builds the medical education context block injected into generation prompts
 * for NMC CBME-aligned medical education content.
 *
 * Called by the generation pipeline with enriched competency data from
 * the /api/competencies/enrich endpoint.
 */

export interface MedicalCompetency {
  competency_code: string;
  competency_text: string;
  domain: string;
  subject_name: string;
  topic_name: string;
  teaching_methods?: string;
  assessment_methods?: string;
}

/**
 * Build the medical education context block injected into generation prompts.
 *
 * When competencies are provided, produces a detailed context block with
 * competency codes, domain-specific teaching guidance, and NMC requirements.
 * When no competencies are provided, returns a generic medical education wrapper.
 */
export function buildMedicalContext(competencies: MedicalCompetency[]): string {
  if (competencies.length === 0) {
    return `You are generating content for medical education in India, aligned with the National Medical Commission (NMC) Competency-Based Medical Education (CBME) curriculum. Use clinical examples relevant to Indian healthcare settings. Maintain strict medical accuracy.

Medical slides should be visually rich — request AI-generated images (via mediaGenerations) for anatomical diagrams, flowcharts, pathway diagrams, and clinical schematics. Use "medical illustration style, labeled diagram, educational" in image prompts. Aim for at least one visual element per slide.`;
  }

  const competencyList = competencies
    .map(
      (c) =>
        `- ${c.competency_code}: ${c.competency_text} [Domain: ${c.domain}] [Subject: ${c.subject_name} — ${c.topic_name}]`,
    )
    .join('\n');

  const domains = [...new Set(competencies.map((c) => c.domain))];
  const domainGuidance = domains
    .map((d) => {
      switch (d) {
        case 'K':
          return '- Knowledge (K): Use conceptual diagrams, definitions, classifications, and explanations';
        case 'S':
          return '- Skills (S): Include procedural demonstrations, step-by-step techniques, and hands-on activities';
        case 'A':
          return '- Attitude (A): Include case discussions, ethical scenarios, and communication exercises';
        case 'K/S':
          return '- Knowledge+Skills (K/S): Combine conceptual understanding with practical application';
        case 'K/S/A':
          return '- All domains (K/S/A): Integrate knowledge, skills, and attitude components';
        default:
          return `- ${d}: Adapt content to this domain`;
      }
    })
    .join('\n');

  // Collect teaching and assessment methods if provided
  const teachingMethods = [
    ...new Set(
      competencies
        .map((c) => c.teaching_methods)
        .filter((m): m is string => !!m),
    ),
  ];
  const assessmentMethods = [
    ...new Set(
      competencies
        .map((c) => c.assessment_methods)
        .filter((m): m is string => !!m),
    ),
  ];

  const methodsSection =
    teachingMethods.length > 0 || assessmentMethods.length > 0
      ? `\n## Suggested Methods
${teachingMethods.length > 0 ? `Teaching: ${teachingMethods.join('; ')}` : ''}
${assessmentMethods.length > 0 ? `Assessment: ${assessmentMethods.join('; ')}` : ''}`
      : '';

  return `You are generating content for medical education in India, aligned with the National Medical Commission (NMC) Competency-Based Medical Education (CBME) 2024 curriculum.

## NMC Competencies to Cover
${competencyList}

## Domain-Specific Teaching Guidance
${domainGuidance}
${methodsSection}
## Medical Diagram & Visual Guidance
- **IMPORTANT**: Medical slides should be visually rich. Request AI-generated images (via mediaGenerations) for:
  - Anatomical diagrams with clearly labeled structures
  - Flowcharts showing pathogenesis, metabolic pathways, or disease progression
  - Comparison diagrams (normal vs pathological, before vs after)
  - Schematic diagrams of physiological mechanisms (feedback loops, nerve pathways, blood flow)
  - Clinical images showing signs/symptoms (use schematic/diagrammatic style, not photorealistic)
- Use **charts** for: lab reference ranges, drug dosage tables, growth charts, statistical data
- Use **tables** for: differential diagnosis, drug comparisons, classification systems
- Use **LaTeX** for: chemical formulas, dosage calculations, Henderson-Hasselbalch equation
- Use **shapes + lines** for: simple flowcharts, pathway diagrams, anatomical outlines
- Aim for at least one visual element (image, chart, or diagram) per slide — medical education is highly visual
- Image prompts should specify "medical illustration style, labeled diagram, educational, clean white background" for clarity
- For anatomy: "anatomical diagram showing [structure] with labeled parts, medical textbook illustration style"
- For pathology: "schematic diagram of [disease process], showing [normal vs pathological], educational medical illustration"
- For physiology: "flowchart diagram of [mechanism/pathway], with arrows showing [flow/regulation], medical education style"
- For biochemistry: "metabolic pathway diagram showing [pathway name], with enzymes, substrates, and products labeled"

## Speech & Narration Guidelines
- Do NOT start with "Good morning, students" every time — vary greetings naturally. Use different openings like "Welcome everyone", "Let's begin today's session on...", "Namaste, let's explore...", "Today we'll be studying...", "Let's dive into...", or simply start with the topic directly
- Keep speech natural and conversational — avoid overly formal or robotic phrasing
- When greeting, rotate between styles: direct topic introduction (most common), casual welcome, or context-setting opening
- Avoid long pauses in speech text — do not use "..." or excessive punctuation that creates unnatural breaks

## Requirements
- Every scene MUST map to at least one of the competencies listed above
- Use clinical examples relevant to Indian healthcare settings (Indian hospitals, common presentations in India)
- Generate quizzes in NMC examination pattern: single best answer MCQs, clinical vignettes
- Maintain strict medical accuracy — errors in medical education are unacceptable
- Tag each generated scene with the competency codes it covers`;
}

/**
 * Build a lighter medical context for prompts that need minimal medical awareness
 * (e.g., slide layout, action generation) without full competency details.
 */
export function buildLightMedicalContext(): string {
  return `This is medical education content for Indian MBBS students under the NMC CBME curriculum. Use clinically accurate medical terminology and Indian healthcare examples where appropriate.`;
}

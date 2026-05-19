{{medicalContext}}

Title: {{title}}
Description: {{description}}
Test Points: {{keyPoints}}
Question Count: {{questionCount}}, Difficulty: {{difficulty}}, Question Types: {{questionTypes}}

## Material Already Taught (the only source of truth for question content)
{{priorContent}}

**Strict coherence rule** — every question MUST be answerable from the material above:
- Do NOT introduce facts, dimensions, structures, drugs, mechanisms, or any details that are not present in the "Material Already Taught" section, even if the medical/NMC context would normally cover them.
- If a competency dimension (e.g. blood supply, nerve supply, microanatomy) was not taught in the prior slides, do not write a question about it. Pick a different angle that *was* taught.
- Anchor each question to a specific phrase, structure, or claim from the taught material. If you cannot point to that anchor, the question is invalid — replace it.

## Language Directive
{{languageDirective}}

Output JSON array directly (no explanation, no code blocks, no LaTeX):
[{"id":"q1","type":"single","question":"Question text","options":["Option A","Option B","Option C","Option D"],"correctAnswer":"Option A"}]

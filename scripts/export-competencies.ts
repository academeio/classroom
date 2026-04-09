import { neon } from '@neondatabase/serverless';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('Set DATABASE_URL env var');
    process.exit(1);
  }

  const sql = neon(databaseUrl);

  // Single JOIN query — fetch all competencies with subject/topic info
  const rows = await sql`
    SELECT
      s.code as subject_code,
      s.name as subject_name,
      s.display_order as subject_order,
      t.name as topic_name,
      t.display_order as topic_order,
      c.competency_code as code,
      c.competency_text as text,
      c.domain,
      c.competency_level as level,
      c.is_core,
      c.teaching_methods,
      c.assessment_methods
    FROM competencies c
    JOIN topics t ON c.topic_id = t.id
    JOIN subjects s ON t.subject_id = s.id
    WHERE c.deleted_at IS NULL AND c.curriculum_version = '2024'
    ORDER BY s.display_order, s.name, t.display_order, t.name, c.competency_code
  `;

  // Group into subjects -> topics -> competencies
  const subjectMap = new Map<string, any>();

  for (const row of rows) {
    if (!subjectMap.has(row.subject_code)) {
      subjectMap.set(row.subject_code, {
        code: row.subject_code,
        name: row.subject_name,
        topics: new Map<string, any>(),
      });
    }
    const subject = subjectMap.get(row.subject_code)!;

    if (!subject.topics.has(row.topic_name)) {
      subject.topics.set(row.topic_name, {
        name: row.topic_name,
        competencies: [],
      });
    }

    subject.topics.get(row.topic_name)!.competencies.push({
      code: row.code,
      text: row.text,
      domain: row.domain,
      level: row.level,
      isCore: Boolean(row.is_core),
      teachingMethods: row.teaching_methods,
      assessmentMethods: row.assessment_methods,
    });
  }

  const result = {
    version: '2024',
    exportedAt: new Date().toISOString(),
    subjects: Array.from(subjectMap.values()).map((s: any) => ({
      code: s.code,
      name: s.name,
      topics: Array.from(s.topics.values()),
    })),
  };

  const totalCompetencies = result.subjects.reduce(
    (sum: number, s: any) => sum + s.topics.reduce(
      (tSum: number, t: any) => tSum + t.competencies.length, 0
    ), 0
  );

  // Write output
  const outDir = join(process.cwd(), 'lib/data');
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, 'nmc-competencies-2024.json');
  const jsonStr = JSON.stringify(result, null, 2);
  writeFileSync(outPath, jsonStr);

  console.log(`Exported ${totalCompetencies} competencies across ${result.subjects.length} subjects`);
  console.log(`File size: ${(jsonStr.length / 1024).toFixed(1)}KB`);
  console.log(`Written to: ${outPath}`);
}

main().catch(console.error);

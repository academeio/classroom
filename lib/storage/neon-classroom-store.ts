import { getDb } from '@/lib/neon/client';

export interface ClassroomRecord {
  id: string;
  title: string;
  competency_codes: string[];
  subject_codes: string[];
  classroom_data: any;
  created_by?: string;
  created_at: string;
  generation_model?: string;
  is_pilot: boolean;
}

export async function saveClassroom(classroom: {
  id: string;
  title: string;
  competencyCodes: string[];
  subjectCodes: string[];
  data: any;
  model?: string;
  isPilot?: boolean;
}): Promise<string> {
  const sql = getDb();
  const dataStr = JSON.stringify(classroom.data);

  if (dataStr.length > 1_000_000) {
    throw new Error('Classroom data exceeds 1MB limit');
  }

  await sql`
    INSERT INTO classrooms (id, title, competency_codes, subject_codes, classroom_data, generation_model, is_pilot)
    VALUES (${classroom.id}, ${classroom.title}, ${classroom.competencyCodes}, ${classroom.subjectCodes}, ${classroom.data}::jsonb, ${classroom.model ?? null}, ${classroom.isPilot ?? false})
    ON CONFLICT (id) DO UPDATE SET
      classroom_data = EXCLUDED.classroom_data,
      title = EXCLUDED.title
  `;

  return classroom.id;
}

export async function getClassroom(id: string): Promise<ClassroomRecord | null> {
  const sql = getDb();
  const rows = await sql`
    SELECT * FROM classrooms WHERE id = ${id}
  `;
  return (rows[0] as ClassroomRecord) ?? null;
}

export async function listClassrooms(limit = 50): Promise<ClassroomRecord[]> {
  const sql = getDb();
  const rows = await sql`
    SELECT id, title, competency_codes, subject_codes, created_at, generation_model, is_pilot
    FROM classrooms
    ORDER BY created_at DESC
    LIMIT ${limit}
  `;
  return rows as ClassroomRecord[];
}

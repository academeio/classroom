import { type NextRequest } from 'next/server';
import { apiSuccess, apiError } from '@/lib/server/api-response';
import { getDb } from '@/lib/neon/client';

export async function GET(request: NextRequest) {
  try {
    const sql = getDb();
    const { searchParams } = request.nextUrl;
    const subject = searchParams.get('subject');
    const topic = searchParams.get('topic');

    // Level 3: list competencies for a subject + topic
    if (subject && topic) {
      const rows = await sql`
        SELECT
          c.competency_code,
          c.competency_text,
          c.domain,
          c.competency_level,
          c.is_core,
          c.teaching_methods,
          c.assessment_methods,
          s.code   AS subject_code,
          s.name   AS subject_name,
          t.name   AS topic_name
        FROM competencies c
        JOIN topics t  ON t.id = c.topic_id
        JOIN subjects s ON s.id = t.subject_id
        WHERE c.deleted_at IS NULL
          AND c.curriculum_version = '2024'
          AND s.code = ${subject}
          AND t.name = ${topic}
        ORDER BY c.competency_code
      `;
      return apiSuccess({ data: rows });
    }

    // Level 2: list topics for a subject with counts
    if (subject) {
      const rows = await sql`
        SELECT
          t.name AS topic_name,
          COUNT(c.id)::int AS competency_count
        FROM topics t
        JOIN subjects s ON s.id = t.subject_id
        LEFT JOIN competencies c ON c.topic_id = t.id
          AND c.deleted_at IS NULL
          AND c.curriculum_version = '2024'
        WHERE s.code = ${subject}
        GROUP BY t.name, t.display_order
        ORDER BY t.display_order
      `;
      return apiSuccess({ data: rows });
    }

    // Level 1: list all subjects with competency counts
    const rows = await sql`
      SELECT
        s.code AS subject_code,
        s.name AS subject_name,
        COUNT(c.id)::int AS competency_count
      FROM subjects s
      LEFT JOIN topics t ON t.subject_id = s.id
      LEFT JOIN competencies c ON c.topic_id = t.id
        AND c.deleted_at IS NULL
        AND c.curriculum_version = '2024'
      GROUP BY s.code, s.name, s.display_order
      ORDER BY s.display_order
    `;
    return apiSuccess({ data: rows });
  } catch (error) {
    console.error('Competencies browse error:', error);
    return apiError('INTERNAL_ERROR', 500, 'Failed to fetch competencies');
  }
}

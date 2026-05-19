import { type NextRequest } from 'next/server';
import { apiSuccess, apiError } from '@/lib/server/api-response';
import { getDb } from '@/lib/neon/client';

export async function GET(request: NextRequest) {
  try {
    const q = request.nextUrl.searchParams.get('q')?.trim() ?? '';

    if (q.length < 2) {
      return apiError('INVALID_REQUEST', 400, 'Query must be at least 2 characters');
    }

    const sql = getDb();
    const pattern = `%${q}%`;

    const rows = await sql`
      SELECT
        c.competency_code,
        c.competency_text,
        c.domain,
        c.competency_level,
        c.is_core,
        c.teaching_methods,
        c.assessment_methods,
        s.code  AS subject_code,
        s.name  AS subject_name,
        t.name  AS topic_name
      FROM competencies c
      JOIN topics t  ON t.id = c.topic_id
      JOIN subjects s ON s.id = t.subject_id
      WHERE c.deleted_at IS NULL
        AND c.curriculum_version = '2024'
        AND (c.competency_code ILIKE ${pattern} OR c.competency_text ILIKE ${pattern})
      ORDER BY c.competency_code
      LIMIT 50
    `;

    return apiSuccess({ data: rows });
  } catch (error) {
    console.error('Competency search error:', error);
    return apiError('INTERNAL_ERROR', 500, 'Failed to search competencies');
  }
}

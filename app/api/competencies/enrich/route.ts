import { type NextRequest } from 'next/server';
import { apiSuccess, apiError } from '@/lib/server/api-response';
import { getDb } from '@/lib/neon/client';

const MAX_CODES = 8;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const codes: unknown = body?.codes;

    if (!Array.isArray(codes) || codes.length === 0) {
      return apiError('INVALID_REQUEST', 400, 'Request body must include a non-empty "codes" array');
    }

    if (codes.length > MAX_CODES) {
      return apiError('INVALID_REQUEST', 400, `Maximum ${MAX_CODES} codes per request`);
    }

    // Validate all entries are strings
    if (!codes.every((c): c is string => typeof c === 'string' && c.length > 0)) {
      return apiError('INVALID_REQUEST', 400, 'All codes must be non-empty strings');
    }

    const sql = getDb();

    // neon tagged template supports arrays via ANY()
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
        AND c.competency_code = ANY(${codes})
      ORDER BY c.competency_code
    `;

    return apiSuccess({ data: rows });
  } catch (error) {
    console.error('Competency enrich error:', error);
    return apiError('INTERNAL_ERROR', 500, 'Failed to enrich competencies');
  }
}

import { type NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/neon/client';

export async function GET(request: NextRequest) {
  const id = request.nextUrl.searchParams.get('id') || '9V-zCorw6a';
  try {
    const sql = getDb();
    const rows = await sql`SELECT id, title, created_at FROM classrooms WHERE id = ${id}`;
    const count = await sql`SELECT count(*) as cnt FROM classrooms`;
    return NextResponse.json({
      dbUrl: process.env.DATABASE_URL?.replace(/:[^@]+@/, ':***@'),
      classroomFound: rows.length > 0,
      classroom: rows[0] || null,
      totalClassrooms: count[0]?.cnt,
    });
  } catch (err) {
    return NextResponse.json({
      error: err instanceof Error ? err.message : String(err),
      dbUrl: process.env.DATABASE_URL?.replace(/:[^@]+@/, ':***@'),
    });
  }
}

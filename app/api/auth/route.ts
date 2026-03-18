import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createHmac } from 'crypto';

function signSession(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error('SESSION_SECRET not set');
  const expiry = Date.now() + 24 * 60 * 60 * 1000;
  const payload = `academe:${expiry}`;
  const sig = createHmac('sha256', secret).update(payload).digest('hex');
  return `${payload}:${sig}`;
}

export function verifySession(token: string): boolean {
  const secret = process.env.SESSION_SECRET;
  if (!secret || !token) return false;
  const parts = token.split(':');
  if (parts.length !== 3) return false;
  const [prefix, expiryStr, sig] = parts;
  const payload = `${prefix}:${expiryStr}`;
  const expected = createHmac('sha256', secret).update(payload).digest('hex');
  if (sig !== expected) return false;
  if (Date.now() > parseInt(expiryStr, 10)) return false;
  return true;
}

export async function POST(request: NextRequest) {
  const { password } = await request.json();
  const expected = process.env.GENERATION_PASSWORD;

  if (!expected) {
    return NextResponse.json({ error: 'Auth not configured' }, { status: 500 });
  }

  if (password !== expected) {
    return NextResponse.json({ error: 'Invalid password' }, { status: 401 });
  }

  const token = signSession();
  const cookieStore = await cookies();
  cookieStore.set('academe-session', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 60 * 24,
    path: '/',
  });

  return NextResponse.json({ success: true });
}

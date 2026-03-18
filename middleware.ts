import { NextRequest, NextResponse } from 'next/server';
import { createHmac } from 'crypto';

const PROTECTED_ROUTES = ['/', '/generation-preview'];
const PROTECTED_API_PREFIXES = ['/api/generate', '/api/competencies/enrich'];
const PUBLIC_ROUTES = ['/login', '/guide', '/classroom'];
const PUBLIC_API_PREFIXES = ['/api/auth', '/api/classroom', '/api/health'];
const PUBLIC_API_EXACT = ['/api/competencies', '/api/competencies/search'];

function verifyToken(token: string): boolean {
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

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (PUBLIC_ROUTES.some(r => pathname.startsWith(r))) {
    return NextResponse.next();
  }
  if (PUBLIC_API_PREFIXES.some(p => pathname.startsWith(p))) {
    return NextResponse.next();
  }
  if (PUBLIC_API_EXACT.some(p => pathname === p)) {
    return NextResponse.next();
  }

  const needsAuth =
    PROTECTED_ROUTES.includes(pathname) ||
    PROTECTED_API_PREFIXES.some(p => pathname.startsWith(p));

  if (!needsAuth) {
    return NextResponse.next();
  }

  const session = request.cookies.get('academe-session');
  if (session?.value && verifyToken(session.value)) {
    return NextResponse.next();
  }

  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  return NextResponse.redirect(new URL('/login', request.url));
}

export const config = {
  matcher: ['/', '/generation-preview', '/api/generate/:path*', '/api/competencies/enrich'],
};

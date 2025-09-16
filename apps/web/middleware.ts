import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const PUBLIC_PATHS = ["/login", "/_next", "/favicon.ico", "/api"];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }
  try {
    const res = await fetch(`${request.nextUrl.origin}/api/auth/me`, {
      headers: { cookie: request.headers.get('cookie') || '' },
      cache: 'no-store',
      credentials: 'include' as any,
    });
    if (res.ok) {
      const data = await res.json();
      if (data?.authenticated) return NextResponse.next();
    }
  } catch (e) {}
  const loginUrl = request.nextUrl.clone();
  loginUrl.pathname = '/login';
  loginUrl.searchParams.set('next', pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ['/((?!_next|favicon.ico).*)'],
};

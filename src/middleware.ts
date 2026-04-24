import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { middlewareCookies } from '@/lib/supabase/cookie-adapter';

const PUBLIC_PATHS = ['/login', '/auth/callback', '/auth/signout'];

export async function middleware(req: NextRequest) {
  const res = NextResponse.next();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';

  if (!url || !anon) return res;

  const supabase = createServerClient(url, anon, {
    cookies: middlewareCookies(req, res),
  });

  const {
    data: { session },
  } = await supabase.auth.getSession();

  const { pathname } = req.nextUrl;
  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + '/'));
  const isStatic =
    pathname.startsWith('/_next') ||
    pathname.startsWith('/favicon') ||
    pathname.startsWith('/agsi-logo') ||
    pathname === '/robots.txt';

  if (!session && !isPublic && !isStatic) {
    const loginUrl = req.nextUrl.clone();
    loginUrl.pathname = '/login';
    loginUrl.searchParams.set('next', pathname);
    return NextResponse.redirect(loginUrl);
  }

  if (session && pathname === '/login') {
    const dash = req.nextUrl.clone();
    dash.pathname = '/dashboard';
    return NextResponse.redirect(dash);
  }

  return res;
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|agsi-logo.svg).*)'],
};

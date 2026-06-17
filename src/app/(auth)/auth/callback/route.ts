import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';
import { mutableCookies } from '@/lib/supabase/cookie-adapter';

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const next = url.searchParams.get('next') ?? '/dashboard';

  if (!code) {
    return NextResponse.redirect(new URL('/login?error=missing_code', url.origin));
  }

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: mutableCookies(cookies()) },
  );

  const { data: session, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return NextResponse.redirect(
      new URL(`/login?error=${encodeURIComponent(error.message)}`, url.origin),
    );
  }

  // Invite-only gate. Anyone (Google or magic-link) can complete the
  // OAuth handshake — Supabase has no way to refuse it without a
  // pre-existing user row. We bounce them HERE rather than letting
  // middleware -> getCurrentUser do it later: the middleware's
  // /login -> /dashboard convenience-redirect plus get-user.ts's
  // /dashboard -> /login?error=profile_missing produces an infinite
  // loop for a session that has no profile. Killing the session at
  // the callback closes the loop and shows the friendly error.
  const userId = session.user?.id;
  if (userId) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('id, is_active')
      .eq('id', userId)
      .maybeSingle();
    if (!profile) {
      await supabase.auth.signOut();
      return NextResponse.redirect(
        new URL('/login?error=profile_missing', url.origin),
      );
    }
    if (!profile.is_active) {
      await supabase.auth.signOut();
      return NextResponse.redirect(
        new URL('/login?error=account_deactivated', url.origin),
      );
    }
  }

  return NextResponse.redirect(new URL(next, url.origin));
}

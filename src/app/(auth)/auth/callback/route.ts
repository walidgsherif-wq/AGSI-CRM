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

  // Invite-only gate. H8 fix (Apr 2026): when a profile is missing for
  // the OAuth user-id, consult the invited_users allow-list before
  // bouncing. If the email is on the list, atomically create the
  // profile NOW with the real OAuth user-id and clear the invite row.
  //
  // This works because invitations no longer pre-create auth.users —
  // they just stash metadata. So the OAuth flow always mints a fresh
  // auth.users row with a Google identity attached, and the profile
  // gets bound to that real id on first sign-in.
  //
  // Strangers (no profile, no invite) fall through to the existing
  // signOut + profile_missing path.
  const userId = session.user?.id;
  const userEmail = session.user?.email;
  if (userId) {
    let { data: profile } = await supabase
      .from('profiles')
      .select('id, is_active')
      .eq('id', userId)
      .maybeSingle<{ id: string; is_active: boolean }>();

    if (!profile && userEmail) {
      const { data: claimed } = await supabase.rpc('claim_invited_profile', {
        p_email: userEmail,
        p_user_id: userId,
      });
      if (claimed) {
        profile = { id: claimed.id, is_active: claimed.is_active };
      } else {
        // claim_invited_profile returns null when no matching invite
        // exists. The double-tab race produces the same null because
        // the first call deletes the invite row; re-check profiles
        // directly so the losing tab still proceeds.
        const { data: retry } = await supabase
          .from('profiles')
          .select('id, is_active')
          .eq('id', userId)
          .maybeSingle<{ id: string; is_active: boolean }>();
        profile = retry ?? null;
      }
    }

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

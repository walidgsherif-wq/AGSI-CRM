import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createServerClient } from '@supabase/ssr';
import type { Role } from '@/types/domain';
import { ROLES } from '@/types/domain';
import { DEV_ROLE_COOKIE } from './shared';
import { serverComponentCookies } from '@/lib/supabase/cookie-adapter';

export { DEV_ROLE_COOKIE };

export type CurrentUser = {
  id: string;
  email: string;
  fullName: string;
  role: Role;
};

/**
 * Returns the currently authenticated user's profile.
 * Redirects to /login if not authenticated.
 *
 * Dev override: if NODE_ENV !== 'production' AND the `agsi_dev_role`
 * cookie is set:
 *   - With a real session, the cookie overrides the profile's real role
 *     (display only — DB writes still go under the real role via RLS).
 *   - Without a real session, a synthetic CurrentUser is returned so the
 *     M1 shell remains previewable locally without Supabase env vars.
 */
export async function getCurrentUser(): Promise<CurrentUser> {
  const cookieStore = cookies();
  const devOverride = cookieStore.get(DEV_ROLE_COOKIE)?.value;
  const isDev = process.env.NODE_ENV !== 'production';
  const isValidDevRole =
    !!devOverride && (ROLES as readonly string[]).includes(devOverride);

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
    { cookies: serverComponentCookies(cookieStore) },
  );

  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();

  if (!authUser) {
    if (isDev && isValidDevRole) {
      return {
        id: `dev-${devOverride}`,
        email: `dev-${devOverride}@local`,
        fullName: `Dev ${devOverride}`,
        role: devOverride as Role,
      };
    }
    redirect('/login');
  }

  const { data: profile, error } = await supabase
    .from('profiles')
    .select('id, full_name, email, role, is_active')
    .eq('id', authUser.id)
    .single();

  if (error || !profile) {
    redirect('/login?error=profile_missing');
  }

  if (!profile.is_active) {
    redirect('/login?error=account_deactivated');
  }

  const role: Role = isDev && isValidDevRole ? (devOverride as Role) : (profile.role as Role);

  return {
    id: profile.id,
    email: profile.email,
    fullName: profile.full_name,
    role,
  };
}

import { cookies } from 'next/headers';
import type { Role } from '@/types/domain';
import { ROLES } from '@/types/domain';
import { DEV_ROLE_COOKIE } from './shared';

export { DEV_ROLE_COOKIE };

export type CurrentUser = {
  id: string;
  email: string;
  fullName: string;
  role: Role;
  isDev: boolean;
};

/**
 * M1: auth is not yet wired (Supabase magic-link arrives in M3).
 * Until then, the role is resolved from:
 *   1. A cookie `agsi_dev_role` set by the dev role switcher in the sidebar
 *   2. Fallback to NEXT_PUBLIC_DEV_ROLE_DEFAULT env var
 *   3. Fallback to 'admin'
 *
 * Once M3 lands, this function swaps to a Supabase session lookup and
 * the dev cookie is no-op in production.
 */
export async function getCurrentUser(): Promise<CurrentUser> {
  const cookieStore = cookies();
  const cookieRole = cookieStore.get(DEV_ROLE_COOKIE)?.value;
  const envRole = process.env.NEXT_PUBLIC_DEV_ROLE_DEFAULT;
  const role = resolveRole(cookieRole ?? envRole);
  return {
    id: 'dev-user',
    email: process.env.INITIAL_ADMIN_EMAIL ?? 'walid.g.sherif@gmail.com',
    fullName: 'Dev User',
    role,
    isDev: true,
  };
}

function resolveRole(candidate: string | undefined): Role {
  if (candidate && (ROLES as readonly string[]).includes(candidate)) {
    return candidate as Role;
  }
  return 'admin';
}

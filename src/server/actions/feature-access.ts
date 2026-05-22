'use server';

import { revalidatePath } from 'next/cache';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { serverComponentCookies } from '@/lib/supabase/cookie-adapter';
import { getCurrentUser } from '@/lib/auth/get-user';
import type { FeatureKey } from '@/lib/auth/features';

function supabase() {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
    { cookies: serverComponentCookies(cookies()) },
  );
}

export type FeatureActionResult = { ok: true } | { error: string };

/**
 * Sets an explicit allow/deny override for one user + feature. Wins
 * over the role default. Audit-logged.
 */
export async function setFeatureOverride(
  userId: string,
  feature: FeatureKey,
  allowed: boolean,
): Promise<FeatureActionResult> {
  const user = await getCurrentUser();
  if (user.role !== 'admin') return { error: 'admin only' };

  const { error } = await supabase().rpc('set_feature_access_with_audit', {
    p_user_id: userId,
    p_feature: feature,
    p_allowed: allowed,
  });
  if (error) return { error: error.message };
  revalidatePath(`/admin/users/${userId}/access`);
  revalidatePath('/admin/users');
  return { ok: true };
}

/**
 * Clears any override for one user + feature, reverting to the role
 * default. No-op if no override exists. Audit-logged.
 */
export async function clearFeatureOverride(
  userId: string,
  feature: FeatureKey,
): Promise<FeatureActionResult> {
  const user = await getCurrentUser();
  if (user.role !== 'admin') return { error: 'admin only' };

  const { error } = await supabase().rpc('clear_feature_access_with_audit', {
    p_user_id: userId,
    p_feature: feature,
  });
  if (error) return { error: error.message };
  revalidatePath(`/admin/users/${userId}/access`);
  revalidatePath('/admin/users');
  return { ok: true };
}

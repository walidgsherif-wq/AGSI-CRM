'use server';

import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { serverComponentCookies } from '@/lib/supabase/cookie-adapter';
import { getCurrentUser } from '@/lib/auth/get-user';

function supabase() {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
    { cookies: serverComponentCookies(cookies()) },
  );
}

export type CoverageDiagnostics = {
  total: number;
  is_active_true: number;
  is_active_not_true: number;
  merged_null: number;
  merged_not_null: number;
  all_three_filters: number;
  owner_null_in_universe: number;
  owner_not_null_in_universe: number;
  by_type: Record<string, number>;
  by_type_survivors: Record<string, number>;
  spoke_types: string[];
};

/**
 * Step-0 diagnostic for the "Coverage" and "Segment penetration"
 * panels showing 0-of-0. Wraps get_coverage_diagnostics() (0092)
 * and mirrors the counts to the server log so we can see them in
 * Vercel too. Admin/bd_head/leadership only.
 */
export async function getCoverageDiagnostics(): Promise<
  CoverageDiagnostics | { error: string }
> {
  const user = await getCurrentUser();
  if (!['admin', 'bd_head', 'leadership'].includes(user.role)) {
    return { error: 'forbidden' };
  }
  const { data, error } = await supabase().rpc('get_coverage_diagnostics');
  if (error) {
    console.error('[coverage-diagnostics] rpc failed', error);
    return { error: error.message };
  }
  const payload = (data as CoverageDiagnostics) ?? null;
  if (payload) {
    console.log('[coverage-diagnostics]', JSON.stringify(payload));
  }
  return payload ?? { error: 'empty' };
}

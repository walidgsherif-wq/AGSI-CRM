'use server';

import { revalidatePath } from 'next/cache';
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

export type StagnationResult = { warnings_fired: number; breaches_fired: number };
export type CompositionResult = { fired: number };

export async function runStagnationEval(): Promise<
  { result: StagnationResult } | { error: string }
> {
  const user = await getCurrentUser();
  if (user.role !== 'admin') return { error: 'admin only' };
  const { data, error } = await supabase().rpc('eval_stagnation');
  if (error) return { error: error.message };
  const row = (data as StagnationResult[] | null)?.[0] ?? {
    warnings_fired: 0,
    breaches_fired: 0,
  };
  revalidatePath('/admin/notifications-eval');
  return {
    result: {
      warnings_fired: Number(row.warnings_fired ?? 0),
      breaches_fired: Number(row.breaches_fired ?? 0),
    },
  };
}

export async function runCompositionWarning(): Promise<
  { result: CompositionResult } | { error: string }
> {
  const user = await getCurrentUser();
  if (user.role !== 'admin') return { error: 'admin only' };
  const { data, error } = await supabase().rpc('eval_composition_warning');
  if (error) return { error: error.message };
  const row = (data as CompositionResult[] | null)?.[0] ?? { fired: 0 };
  revalidatePath('/admin/notifications-eval');
  return { result: { fired: Number(row.fired ?? 0) } };
}

export async function runCompositionDrift(): Promise<
  { result: CompositionResult } | { error: string }
> {
  const user = await getCurrentUser();
  if (user.role !== 'admin') return { error: 'admin only' };
  const { data, error } = await supabase().rpc('eval_composition_drift');
  if (error) return { error: error.message };
  const row = (data as CompositionResult[] | null)?.[0] ?? { fired: 0 };
  revalidatePath('/admin/notifications-eval');
  return { result: { fired: Number(row.fired ?? 0) } };
}

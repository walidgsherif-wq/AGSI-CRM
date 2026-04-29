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

export async function rebuildEcosystem() {
  const user = await getCurrentUser();
  if (user.role === 'bd_manager') return { error: 'forbidden' };
  const { error } = await supabase().rpc('rebuild_ecosystem_awareness');
  if (error) return { error: error.message };
  revalidatePath('/admin/ecosystem-rebuild');
  revalidatePath('/insights/ecosystem');
  return { ok: true };
}

export type BackfillRow = { category: string; inserted: number };

export async function backfillEcosystem(): Promise<
  { rows: BackfillRow[] } | { error: string }
> {
  const user = await getCurrentUser();
  if (user.role !== 'admin') return { error: 'admin only' };
  const { data, error } = await supabase().rpc('backfill_ecosystem_events');
  if (error) return { error: error.message };
  revalidatePath('/admin/ecosystem-rebuild');
  revalidatePath('/insights/ecosystem');
  return {
    rows: (data ?? []).map((r: { category: string; inserted: number | string }) => ({
      category: r.category,
      inserted: Number(r.inserted),
    })),
  };
}

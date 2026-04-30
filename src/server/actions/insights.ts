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

export async function generateMarketSnapshot(uploadId: string) {
  const user = await getCurrentUser();
  if (user.role !== 'admin') return { error: 'admin only' };
  const { error } = await supabase().rpc('generate_market_snapshot', {
    p_upload_id: uploadId,
  });
  if (error) return { error: error.message };
  revalidatePath(`/admin/uploads/${uploadId}`);
  revalidatePath('/insights');
  return { ok: true };
}

export async function backfillAllMarketSnapshots(): Promise<
  { snapshots_generated: number } | { error: string }
> {
  const user = await getCurrentUser();
  if (user.role !== 'admin') return { error: 'admin only' };
  const { data, error } = await supabase().rpc('backfill_all_market_snapshots');
  if (error) return { error: error.message };
  revalidatePath('/admin/uploads');
  revalidatePath('/admin/rebar-prices');
  revalidatePath('/insights');
  const row = (data as { snapshots_generated: number | string }[] | null)?.[0];
  return { snapshots_generated: Number(row?.snapshots_generated ?? 0) };
}

export type RebarPriceRow = {
  id: string;
  effective_month: string;
  price_aed_per_tonne: number;
  notes: string | null;
  entered_at: string;
  entered_by_name: string | null;
};

export async function listRebarPrices(): Promise<RebarPriceRow[]> {
  await getCurrentUser();
  const { data } = await supabase()
    .from('rebar_price_history')
    .select(
      'id, effective_month, price_aed_per_tonne, notes, entered_at, entered_by:profiles!rebar_price_history_entered_by_fkey(full_name)',
    )
    .order('effective_month', { ascending: false })
    .returns<
      Array<
        Omit<RebarPriceRow, 'entered_by_name'> & {
          entered_by: { full_name: string } | { full_name: string }[] | null;
        }
      >
    >();
  return (data ?? []).map((r) => ({
    id: r.id,
    effective_month: r.effective_month,
    price_aed_per_tonne: Number(r.price_aed_per_tonne),
    notes: r.notes,
    entered_at: r.entered_at,
    entered_by_name: pickName(r.entered_by),
  }));
}

function pickName(g: { full_name: string } | { full_name: string }[] | null): string | null {
  if (!g) return null;
  if (Array.isArray(g)) return g[0]?.full_name ?? null;
  return g.full_name;
}

export async function addRebarPrice(formData: FormData) {
  const user = await getCurrentUser();
  if (user.role !== 'admin') return { error: 'admin only' };

  const month = String(formData.get('effective_month') ?? '');
  const priceRaw = String(formData.get('price_aed_per_tonne') ?? '');
  const notes = String(formData.get('notes') ?? '').trim() || null;

  if (!/^\d{4}-\d{2}$/.test(month) && !/^\d{4}-\d{2}-\d{2}$/.test(month)) {
    return { error: 'Effective month must be YYYY-MM (or YYYY-MM-DD).' };
  }
  const monthDate =
    month.length === 7 ? `${month}-01` : `${month.slice(0, 7)}-01`;
  const price = Number(priceRaw);
  if (!Number.isFinite(price) || price <= 0) {
    return { error: 'Price must be a positive number.' };
  }

  const { error } = await supabase()
    .from('rebar_price_history')
    .upsert(
      {
        effective_month: monthDate,
        price_aed_per_tonne: price,
        notes,
        entered_by: user.id,
        entered_at: new Date().toISOString(),
      },
      { onConflict: 'effective_month' },
    );
  if (error) return { error: error.message };
  revalidatePath('/admin/rebar-prices');
  revalidatePath('/insights');
  return { ok: true };
}

export async function deleteRebarPrice(id: string) {
  const user = await getCurrentUser();
  if (user.role !== 'admin') return { error: 'admin only' };
  const { error } = await supabase().from('rebar_price_history').delete().eq('id', id);
  if (error) return { error: error.message };
  revalidatePath('/admin/rebar-prices');
  revalidatePath('/insights');
  return { ok: true };
}

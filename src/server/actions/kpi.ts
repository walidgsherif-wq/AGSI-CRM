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

/**
 * Manual KPI rebuild trigger — admin only. Runs rebuild_kpi_actuals()
 * for today and refreshes the BEI matview. Replaces the nightly cron
 * for ad-hoc refreshes (e.g. after a bulk import or target edit).
 */
export async function triggerKpiRebuild() {
  const user = await getCurrentUser();
  if (user.role !== 'admin') return { error: 'Admin only.' };

  const { data, error } = await supabase().rpc('rebuild_kpi_actuals');
  if (error) return { error: error.message };

  revalidatePath('/dashboard');
  revalidatePath('/admin/targets');
  return { ok: true, rows_written: data as number };
}

/**
 * Upsert a member-target override. Setting all four quarter values to
 * 0 effectively means "no override"; for cleanliness we still write the
 * row with override_mode = 'custom' so admins can see what was edited.
 */
export async function upsertMemberTarget(formData: FormData) {
  const user = await getCurrentUser();
  if (user.role !== 'admin') return { error: 'Admin only.' };

  const userId = String(formData.get('user_id') ?? '');
  const metricCode = String(formData.get('metric_code') ?? '');
  const fiscalYear = parseInt(String(formData.get('fiscal_year') ?? '0'), 10);
  const q1 = parseFloat(String(formData.get('q1_target') ?? '0')) || 0;
  const q2 = parseFloat(String(formData.get('q2_target') ?? '0')) || 0;
  const q3 = parseFloat(String(formData.get('q3_target') ?? '0')) || 0;
  const q4 = parseFloat(String(formData.get('q4_target') ?? '0')) || 0;

  if (!userId || !metricCode || !fiscalYear) {
    return { error: 'Missing user_id, metric_code, or fiscal_year.' };
  }

  const { error } = await supabase()
    .from('member_targets')
    .upsert(
      {
        user_id: userId,
        metric_code: metricCode,
        fiscal_year: fiscalYear,
        q1_target: q1,
        q2_target: q2,
        q3_target: q3,
        q4_target: q4,
        annual_target: q1 + q2 + q3 + q4,
        override_mode: 'custom',
        last_edited_by: user.id,
        last_edited_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,metric_code,fiscal_year' },
    );

  if (error) return { error: error.message };
  revalidatePath('/admin/targets');
  return { ok: true };
}

/** Remove a member-target override, restoring the playbook default. */
export async function clearMemberTarget(userId: string, metricCode: string, fiscalYear: number) {
  const user = await getCurrentUser();
  if (user.role !== 'admin') return { error: 'Admin only.' };

  const { error } = await supabase()
    .from('member_targets')
    .delete()
    .eq('user_id', userId)
    .eq('metric_code', metricCode)
    .eq('fiscal_year', fiscalYear);

  if (error) return { error: error.message };
  revalidatePath('/admin/targets');
  return { ok: true };
}

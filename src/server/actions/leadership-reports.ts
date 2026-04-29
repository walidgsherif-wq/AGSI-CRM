'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { serverComponentCookies } from '@/lib/supabase/cookie-adapter';
import { getCurrentUser } from '@/lib/auth/get-user';
import { reportCreateSchema } from '@/lib/zod/leadership-report';

function supabase() {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
    { cookies: serverComponentCookies(cookies()) },
  );
}

function rawFromForm(formData: FormData) {
  const get = (k: string) => {
    const v = formData.get(k);
    return v === null ? '' : String(v);
  };
  return {
    report_type: get('report_type'),
    period_label: get('period_label'),
    period_start: get('period_start'),
    period_end: get('period_end'),
    fiscal_year: get('fiscal_year'),
    fiscal_quarter: get('fiscal_quarter'),
  };
}

/**
 * Creates a new draft report and runs the SQL generator to populate
 * payload_json + denormalised stakeholder rows. Redirects to the edit
 * page on success.
 */
export async function createReport(formData: FormData) {
  const user = await getCurrentUser();
  if (user.role !== 'admin') return { error: 'admin only' };

  const parsed = reportCreateSchema.safeParse(rawFromForm(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues.map((i) => i.message).join('; ') };
  }
  const data = parsed.data;

  const sb = supabase();

  const { data: inserted, error: insertError } = await sb
    .from('leadership_reports')
    .insert({
      report_type: data.report_type,
      period_label: data.period_label,
      period_start: data.period_start,
      period_end: data.period_end,
      fiscal_year: data.fiscal_year,
      fiscal_quarter: data.fiscal_quarter,
      generated_by: user.id,
      status: 'draft',
    })
    .select('id')
    .single<{ id: string }>();
  if (insertError || !inserted) return { error: insertError?.message ?? 'Insert failed' };

  const { error: genError } = await sb.rpc('generate_leadership_report', {
    p_report_id: inserted.id,
  });
  if (genError) return { error: genError.message };

  revalidatePath('/admin/reports');
  redirect(`/admin/reports/${inserted.id}/edit`);
}

export async function regenerateReport(id: string) {
  const user = await getCurrentUser();
  if (user.role !== 'admin') return { error: 'admin only' };

  const { error } = await supabase().rpc('generate_leadership_report', {
    p_report_id: id,
  });
  if (error) return { error: error.message };
  revalidatePath(`/admin/reports/${id}/edit`);
  return { ok: true };
}

export async function saveExecutiveSummary(id: string, summary: string) {
  const user = await getCurrentUser();
  if (user.role !== 'admin') return { error: 'admin only' };

  const { error } = await supabase()
    .from('leadership_reports')
    .update({ executive_summary: summary })
    .eq('id', id)
    .eq('status', 'draft');
  if (error) return { error: error.message };
  revalidatePath(`/admin/reports/${id}/edit`);
  return { ok: true };
}

export async function saveStakeholderNarrative(rowId: string, narrative: string) {
  const user = await getCurrentUser();
  if (user.role !== 'admin') return { error: 'admin only' };

  // Only allow on draft reports.
  const sb = supabase();
  const { data: row } = await sb
    .from('leadership_report_stakeholders')
    .select('report_id')
    .eq('id', rowId)
    .maybeSingle<{ report_id: string }>();
  if (!row) return { error: 'row not found' };

  const { data: report } = await sb
    .from('leadership_reports')
    .select('status, id')
    .eq('id', row.report_id)
    .maybeSingle<{ status: string; id: string }>();
  if (!report) return { error: 'report not found' };
  if (report.status !== 'draft') return { error: 'narrative can only be edited on drafts' };

  const { error } = await sb
    .from('leadership_report_stakeholders')
    .update({ narrative })
    .eq('id', rowId);
  if (error) return { error: error.message };

  revalidatePath(`/admin/reports/${report.id}/edit`);
  return { ok: true };
}

'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { serverComponentCookies } from '@/lib/supabase/cookie-adapter';
import { getCurrentUser } from '@/lib/auth/get-user';
import { reportCreateSchema } from '@/lib/zod/leadership-report';
import type { LeadershipReportPayload } from '@/lib/zod/leadership-report';
import {
  renderLeadershipPdfBuffer,
  leadershipPdfStoragePath,
} from '@/lib/reports/renderLeadershipPdf';

const PDF_BUCKET = 'leadership-reports';

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

export async function finaliseReport(id: string) {
  const user = await getCurrentUser();
  if (user.role !== 'admin') return { error: 'admin only' };

  const { error } = await supabase().rpc('finalise_leadership_report', {
    p_report_id: id,
  });
  if (error) return { error: error.message };

  // Best-effort PDF persist. Failure here does not roll back the
  // status flip — the user's intent (finalise) succeeded; admins can
  // retry the PDF render via regenerateReportPdf.
  let pdfPersisted = false;
  let pdfError: string | undefined;
  const pdfResult = await renderAndUploadPdf(id);
  if ('error' in pdfResult) {
    pdfError = pdfResult.error;
  } else {
    pdfPersisted = true;
  }

  revalidatePath('/admin/reports');
  revalidatePath(`/admin/reports/${id}/edit`);
  revalidatePath('/reports/leadership');
  revalidatePath(`/reports/leadership/${id}`);
  return { ok: true as const, pdf_persisted: pdfPersisted, pdf_error: pdfError };
}

/**
 * Admin retry for the PDF persist step. Useful when the auto-persist
 * inside finaliseReport failed (transient render or upload error) and
 * the report row has pdf_storage_path = NULL. Idempotent: upserts.
 */
export async function regenerateReportPdf(id: string) {
  const user = await getCurrentUser();
  if (user.role !== 'admin') return { error: 'admin only' };

  const result = await renderAndUploadPdf(id);
  if ('error' in result) return { error: result.error };

  revalidatePath(`/admin/reports/${id}/edit`);
  revalidatePath(`/reports/leadership/${id}`);
  return { ok: true as const, pdf_storage_path: result.pdf_storage_path };
}

type ReportRowForPdf = {
  id: string;
  period_label: string;
  period_start: string;
  period_end: string;
  fiscal_year: number;
  fiscal_quarter: number | null;
  report_type: string;
  status: string;
  finalised_at: string | null;
  executive_summary: string | null;
  payload_json: LeadershipReportPayload;
  leadership_feedback_text: string | null;
  leadership_feedback_at: string | null;
  feedback_by:
    | { full_name: string }
    | { full_name: string }[]
    | null;
};

async function renderAndUploadPdf(
  id: string,
): Promise<{ pdf_storage_path: string } | { error: string }> {
  const sb = supabase();

  const { data: report, error: fetchErr } = await sb
    .from('leadership_reports')
    .select(
      `id, period_label, period_start, period_end, fiscal_year, fiscal_quarter,
       report_type, status, finalised_at, executive_summary, payload_json,
       leadership_feedback_text, leadership_feedback_at,
       feedback_by:profiles!leadership_reports_leadership_feedback_by_fkey(full_name)`,
    )
    .eq('id', id)
    .maybeSingle<ReportRowForPdf>();
  if (fetchErr) return { error: `fetch: ${fetchErr.message}` };
  if (!report) return { error: 'report not found' };

  const feedbackByName = Array.isArray(report.feedback_by)
    ? report.feedback_by[0]?.full_name ?? null
    : report.feedback_by?.full_name ?? null;

  let buffer: Buffer;
  try {
    buffer = await renderLeadershipPdfBuffer(
      {
        id: report.id,
        period_label: report.period_label,
        period_start: report.period_start,
        period_end: report.period_end,
        fiscal_year: report.fiscal_year,
        fiscal_quarter: report.fiscal_quarter,
        report_type: report.report_type,
        status: report.status,
        finalised_at: report.finalised_at,
        executive_summary: report.executive_summary,
        leadership_feedback_text: report.leadership_feedback_text,
        leadership_feedback_at: report.leadership_feedback_at,
        feedback_by_name: feedbackByName,
      },
      report.payload_json,
    );
  } catch (err) {
    return { error: `render: ${err instanceof Error ? err.message : String(err)}` };
  }

  const path = leadershipPdfStoragePath(report.id, report.period_label);
  const { error: uploadErr } = await sb.storage
    .from(PDF_BUCKET)
    .upload(path, buffer, {
      contentType: 'application/pdf',
      upsert: true,
    });
  if (uploadErr) return { error: `upload: ${uploadErr.message}` };

  const { error: updErr } = await sb
    .from('leadership_reports')
    .update({ pdf_storage_path: path })
    .eq('id', report.id);
  if (updErr) return { error: `update path: ${updErr.message}` };

  return { pdf_storage_path: path };
}

export async function archiveReport(id: string) {
  const user = await getCurrentUser();
  if (user.role !== 'admin') return { error: 'admin only' };

  const { error } = await supabase().rpc('archive_leadership_report', {
    p_report_id: id,
  });
  if (error) return { error: error.message };
  revalidatePath('/admin/reports');
  revalidatePath('/reports/leadership');
  revalidatePath(`/reports/leadership/${id}`);
  return { ok: true };
}

/**
 * Leadership writes feedback on a finalised report. The
 * enforce_leadership_feedback_only trigger (migration 0021) guards the
 * column-mask: leadership can ONLY change leadership_feedback_text on
 * status='finalised' rows, and feedback_by/feedback_at are stamped
 * server-side. Admin / bd_head are blocked from writing feedback
 * (only leadership role).
 */
export async function saveLeadershipFeedback(id: string, feedback: string) {
  const user = await getCurrentUser();
  if (user.role !== 'leadership') {
    return { error: 'Only leadership can write report feedback.' };
  }

  const { error } = await supabase()
    .from('leadership_reports')
    .update({ leadership_feedback_text: feedback })
    .eq('id', id);
  if (error) return { error: error.message };
  revalidatePath(`/reports/leadership/${id}`);
  return { ok: true };
}

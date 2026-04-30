// GET /api/reports/leadership/[id]/pdf
// Server-side PDF render of a finalised or archived leadership report.
// On-demand generation: re-renders from payload_json each call. payload_json
// is frozen at finalise time (admin can't regenerate after status flips), so
// the PDF is deterministic and reproducible.
//
// AuthN/Z: relies on the Supabase session cookie + leadership_reports RLS.
//   - admin / leadership / bd_head can read finalised + archived rows.
//   - bd_manager is fully blocked (no RLS policy for them).
//   - drafts are admin-only via the existing select policy.
// We additionally short-circuit drafts in this route so non-admins never
// trigger a full PDF render that would 0-row at the DB layer.

import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { renderToBuffer } from '@react-pdf/renderer';
import { serverComponentCookies } from '@/lib/supabase/cookie-adapter';
import { getCurrentUser } from '@/lib/auth/get-user';
import { LeadershipReportPdf } from '@/lib/reports/LeadershipReportPdf';
import type { LeadershipReportPayload } from '@/lib/zod/leadership-report';

export const runtime = 'nodejs';
export const maxDuration = 30;
export const dynamic = 'force-dynamic';

type ReportRow = {
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

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const user = await getCurrentUser();
  if (user.role === 'bd_manager') {
    return NextResponse.json({ error: 'forbidden' }, { status: 404 });
  }

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
    { cookies: serverComponentCookies(cookies()) },
  );

  const { data: report } = await supabase
    .from('leadership_reports')
    .select(
      `id, period_label, period_start, period_end, fiscal_year, fiscal_quarter,
       report_type, status, finalised_at, executive_summary, payload_json,
       leadership_feedback_text, leadership_feedback_at,
       feedback_by:profiles!leadership_reports_leadership_feedback_by_fkey(full_name)`,
    )
    .eq('id', params.id)
    .maybeSingle<ReportRow>();

  if (!report) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }

  // Drafts are admin-only via this route too.
  if (report.status === 'draft' && user.role !== 'admin') {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }

  const feedbackByName = pickName(report.feedback_by);

  const buffer = await renderToBuffer(
    <LeadershipReportPdf
      report={{
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
      }}
      payload={report.payload_json}
    />,
  );

  const filename = filenameFor(report.period_label);
  // ArrayBuffer slice — Node Buffer is a Uint8Array but TS types in some
  // versions require an explicit cast for NextResponse body.
  const body = buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength,
  ) as ArrayBuffer;

  return new NextResponse(body, {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'private, no-store',
    },
  });
}

function pickName(
  g: { full_name: string } | { full_name: string }[] | null,
): string | null {
  if (!g) return null;
  if (Array.isArray(g)) return g[0]?.full_name ?? null;
  return g.full_name;
}

function filenameFor(periodLabel: string): string {
  const safe = periodLabel.replace(/[^A-Za-z0-9 _-]/g, '').replace(/\s+/g, '-');
  return `agsi-leadership-${safe || 'report'}-${new Date().toISOString().slice(0, 10)}.pdf`;
}

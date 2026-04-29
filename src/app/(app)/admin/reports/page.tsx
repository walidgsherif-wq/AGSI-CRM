import Link from 'next/link';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { serverComponentCookies } from '@/lib/supabase/cookie-adapter';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  REPORT_STATUS_LABEL,
  REPORT_TYPE_LABEL,
  type ReportStatus,
  type ReportType,
} from '@/lib/zod/leadership-report';

export const dynamic = 'force-dynamic';

type Row = {
  id: string;
  report_type: ReportType;
  period_label: string;
  period_start: string;
  period_end: string;
  fiscal_year: number;
  fiscal_quarter: number | null;
  status: ReportStatus;
  generated_at: string;
  finalised_at: string | null;
  generator: { full_name: string } | { full_name: string }[] | null;
};

const STATUS_VARIANT: Record<ReportStatus, 'amber' | 'green' | 'neutral'> = {
  draft: 'amber',
  finalised: 'green',
  archived: 'neutral',
};

export default async function AdminReportsPage() {
  // Admin layout already enforces requireRole(['admin']).
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
    { cookies: serverComponentCookies(cookies()) },
  );

  const { data } = await supabase
    .from('leadership_reports')
    .select(
      'id, report_type, period_label, period_start, period_end, fiscal_year, fiscal_quarter, status, generated_at, finalised_at, generator:profiles!leadership_reports_generated_by_fkey(full_name)',
    )
    .order('period_end', { ascending: false })
    .order('generated_at', { ascending: false })
    .returns<Row[]>();

  const reports = data ?? [];
  const drafts = reports.filter((r) => r.status === 'draft');
  const finalised = reports.filter((r) => r.status === 'finalised');
  const archived = reports.filter((r) => r.status === 'archived');

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-agsi-navy">Leadership reports</h1>
          <p className="mt-1 text-sm text-agsi-darkGray">
            Frozen monthly + quarterly snapshots for board / leadership review. Generate
            a draft, tune the executive summary, then finalise to send to leadership.
          </p>
        </div>
        <Link href={'/admin/reports/new' as never}>
          <Button size="sm">+ New report</Button>
        </Link>
      </div>

      <ReportSection
        title={`Drafts (${drafts.length})`}
        description="Editable. Regenerate or tweak before finalising."
        reports={drafts}
        emptyHint="No drafts. Click + New report above."
      />

      <ReportSection
        title={`Finalised (${finalised.length})`}
        description="Locked. Visible to leadership; awaiting feedback."
        reports={finalised}
        emptyHint="None finalised yet."
      />

      <ReportSection
        title={`Archived (${archived.length})`}
        description="Past reports retained as audit-of-record."
        reports={archived}
        emptyHint="No archived reports."
      />
    </div>
  );
}

function ReportSection({
  title,
  description,
  reports,
  emptyHint,
}: {
  title: string;
  description: string;
  reports: Row[];
  emptyHint: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        {reports.length === 0 ? (
          <p className="px-6 py-4 text-sm text-agsi-darkGray">{emptyHint}</p>
        ) : (
          <ul className="divide-y divide-agsi-lightGray">
            {reports.map((r) => (
              <ReportRow key={r.id} report={r} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function ReportRow({ report }: { report: Row }) {
  const isDraft = report.status === 'draft';
  const href = isDraft
    ? `/admin/reports/${report.id}/edit`
    : `/reports/leadership/${report.id}`;
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
      <div className="min-w-0 flex-1">
        <Link href={href as never} className="block">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-agsi-navy">
              {report.period_label}
            </span>
            <Badge variant={STATUS_VARIANT[report.status]}>
              {REPORT_STATUS_LABEL[report.status]}
            </Badge>
            <Badge variant="blue">{REPORT_TYPE_LABEL[report.report_type]}</Badge>
          </div>
          <p className="mt-1 text-xs text-agsi-darkGray">
            FY{report.fiscal_year}
            {report.fiscal_quarter ? ` Q${report.fiscal_quarter}` : ''} · period{' '}
            {report.period_start} → {report.period_end}
            {' · '}generated {new Date(report.generated_at).toISOString().slice(0, 10)} by{' '}
            {pickName(report.generator)}
            {report.finalised_at &&
              ` · finalised ${new Date(report.finalised_at).toISOString().slice(0, 10)}`}
          </p>
        </Link>
      </div>
      <Link
        href={href as never}
        className="text-xs font-medium text-agsi-accent hover:underline"
      >
        {isDraft ? 'Edit draft →' : 'View →'}
      </Link>
    </li>
  );
}

function pickName(g: { full_name: string } | { full_name: string }[] | null): string {
  if (!g) return 'Unknown';
  if (Array.isArray(g)) return g[0]?.full_name ?? 'Unknown';
  return g.full_name;
}

import Link from 'next/link';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { serverComponentCookies } from '@/lib/supabase/cookie-adapter';
import { requireRole } from '@/lib/auth/require-role';
import { getCurrentUser } from '@/lib/auth/get-user';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
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
  leadership_feedback_at: string | null;
};

export default async function LeadershipReportsArchive() {
  await requireRole(['admin', 'leadership', 'bd_head']);
  const user = await getCurrentUser();

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
    { cookies: serverComponentCookies(cookies()) },
  );

  const { data } = await supabase
    .from('leadership_reports')
    .select(
      'id, report_type, period_label, period_start, period_end, fiscal_year, fiscal_quarter, status, generated_at, finalised_at, leadership_feedback_at',
    )
    .in('status', ['finalised', 'archived'])
    .order('finalised_at', { ascending: false, nullsFirst: false })
    .order('period_end', { ascending: false })
    .returns<Row[]>();

  const rows = data ?? [];
  // Leadership inbox view: awaiting-feedback first, then given-feedback,
  // then archived. Other roles see chronological.
  const sorted =
    user.role === 'leadership'
      ? [
          ...rows.filter((r) => r.status === 'finalised' && !r.leadership_feedback_at),
          ...rows.filter((r) => r.status === 'finalised' && !!r.leadership_feedback_at),
          ...rows.filter((r) => r.status === 'archived'),
        ]
      : rows;

  const awaitingCount =
    user.role === 'leadership'
      ? rows.filter((r) => r.status === 'finalised' && !r.leadership_feedback_at).length
      : 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-agsi-navy">Leadership reports</h1>
        <p className="mt-1 text-sm text-agsi-darkGray">
          Frozen monthly + quarterly snapshots.{' '}
          {user.role === 'leadership' && awaitingCount > 0 && (
            <span className="font-medium text-rag-amber">
              {awaitingCount} awaiting your feedback.
            </span>
          )}
          {user.role === 'leadership' && awaitingCount === 0 && (
            <span>No reports awaiting your feedback.</span>
          )}
        </p>
      </div>

      {sorted.length === 0 ? (
        <Card>
          <CardContent className="p-6 text-sm text-agsi-darkGray">
            No finalised reports yet.
            {user.role === 'admin' && (
              <>
                {' '}
                Generate one from{' '}
                <Link
                  href={'/admin/reports/new' as never}
                  className="text-agsi-accent hover:underline"
                >
                  Admin → Reports → New report
                </Link>
                .
              </>
            )}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <ul className="divide-y divide-agsi-lightGray">
              {sorted.map((r) => (
                <Row key={r.id} row={r} role={user.role} />
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Row({
  row,
  role,
}: {
  row: Row;
  role: 'admin' | 'leadership' | 'bd_head' | 'bd_manager';
}) {
  const isAwaiting =
    row.status === 'finalised' && !row.leadership_feedback_at && role === 'leadership';
  return (
    <li className="px-4 py-3">
      <Link
        href={`/reports/leadership/${row.id}` as never}
        className="block transition-colors hover:bg-agsi-offWhite"
      >
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-agsi-navy">
            {row.period_label}
          </span>
          <Badge variant={row.status === 'finalised' ? 'green' : 'neutral'}>
            {REPORT_STATUS_LABEL[row.status]}
          </Badge>
          <Badge variant="blue">{REPORT_TYPE_LABEL[row.report_type]}</Badge>
          {isAwaiting && <Badge variant="amber">Awaiting feedback</Badge>}
          {row.leadership_feedback_at && (
            <span className="text-xs text-agsi-green">Feedback given</span>
          )}
        </div>
        <p className="mt-1 text-xs text-agsi-darkGray">
          FY{row.fiscal_year}
          {row.fiscal_quarter ? ` Q${row.fiscal_quarter}` : ''} · period{' '}
          {row.period_start} → {row.period_end}
          {row.finalised_at &&
            ` · finalised ${new Date(row.finalised_at).toISOString().slice(0, 10)}`}
        </p>
      </Link>
    </li>
  );
}

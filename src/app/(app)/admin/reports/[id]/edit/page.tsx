import { notFound } from 'next/navigation';
import Link from 'next/link';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { serverComponentCookies } from '@/lib/supabase/cookie-adapter';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  REPORT_STATUS_LABEL,
  REPORT_TYPE_LABEL,
  type LeadershipReportPayload,
  type ReportStatus,
  type ReportType,
} from '@/lib/zod/leadership-report';
import { LevelBadge } from '@/components/domain/LevelBadge';
import { type Level } from '@/types/domain';
import { ExecutiveSummaryEditor } from './_components/ExecutiveSummaryEditor';
import { RegenerateButton } from './_components/RegenerateButton';
import { StakeholderNarrativeEditor } from './_components/StakeholderNarrativeEditor';
import {
  ArchiveButton,
  FinaliseButton,
  RegeneratePdfButton,
} from './_components/FinaliseButton';

export const dynamic = 'force-dynamic';

type Report = {
  id: string;
  report_type: ReportType;
  period_label: string;
  period_start: string;
  period_end: string;
  fiscal_year: number;
  fiscal_quarter: number | null;
  status: ReportStatus;
  generated_at: string;
  executive_summary: string | null;
  payload_json: LeadershipReportPayload;
  pdf_storage_path: string | null;
};

type Stakeholder = {
  id: string;
  company_id: string | null;
  company_name_at_time: string;
  company_type_at_time: string;
  level_at_time: Level;
  owner_name_at_time: string | null;
  is_key_stakeholder: boolean;
  moved_this_period: boolean;
  flagged_stagnating: boolean;
  narrative: string | null;
};

export default async function EditReportPage({ params }: { params: { id: string } }) {
  // Admin layout already enforces requireRole(['admin']).
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
    { cookies: serverComponentCookies(cookies()) },
  );

  const { data: report } = await supabase
    .from('leadership_reports')
    .select(
      'id, report_type, period_label, period_start, period_end, fiscal_year, fiscal_quarter, status, generated_at, executive_summary, payload_json, pdf_storage_path',
    )
    .eq('id', params.id)
    .maybeSingle<Report>();

  if (!report) notFound();

  const { data: stakeholders } = await supabase
    .from('leadership_report_stakeholders')
    .select(
      'id, company_id, company_name_at_time, company_type_at_time, level_at_time, owner_name_at_time, is_key_stakeholder, moved_this_period, flagged_stagnating, narrative',
    )
    .eq('report_id', params.id)
    .order('is_key_stakeholder', { ascending: false })
    .order('company_name_at_time')
    .returns<Stakeholder[]>();

  const isDraft = report.status === 'draft';
  const payload = report.payload_json;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold text-agsi-navy">
              {report.period_label}
            </h1>
            <Badge variant={isDraft ? 'amber' : 'green'}>
              {REPORT_STATUS_LABEL[report.status]}
            </Badge>
            <Badge variant="blue">{REPORT_TYPE_LABEL[report.report_type]}</Badge>
          </div>
          <p className="mt-1 text-sm text-agsi-darkGray">
            FY{report.fiscal_year}
            {report.fiscal_quarter ? ` Q${report.fiscal_quarter}` : ''} · period{' '}
            {report.period_start} → {report.period_end} · generated{' '}
            {new Date(report.generated_at).toISOString().slice(0, 10)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isDraft && <RegenerateButton reportId={report.id} />}
          <Link
            href={`/reports/leadership/${report.id}` as never}
            className="text-xs font-medium text-agsi-accent hover:underline"
          >
            View read-only →
          </Link>
        </div>
      </div>

      {!isDraft && (
        <Card>
          <CardContent className="p-4 text-sm text-agsi-darkGray">
            This report is <strong>{REPORT_STATUS_LABEL[report.status]}</strong>. The payload
            and stakeholder narratives are locked. Open the read-only view to see the
            leadership-facing version.
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Executive summary</CardTitle>
          <CardDescription>
            1–3 paragraphs the admin writes before sending to leadership. Plain text or
            markdown. Editable until the report is finalised.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ExecutiveSummaryEditor
            reportId={report.id}
            initial={report.executive_summary ?? ''}
            disabled={!isDraft}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Executive headlines (frozen)</CardTitle>
          <CardDescription>
            Aggregate counts pulled at generation time. Regenerate to refresh against
            current data.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <HeadlinesGrid headlines={payload.executive_headlines ?? {}} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Pipeline movements (period)</CardTitle>
          <CardDescription>
            Forward + credited level changes during the period; regressions for the audit
            trail.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <PipelineSection payload={payload} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            Stakeholder snapshot ({stakeholders?.length ?? 0})
          </CardTitle>
          <CardDescription>
            Companies touched in the period or flagged as key. Add per-row narrative
            (admin-written one-liners) before finalising — they appear in the leadership
            report.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {!stakeholders || stakeholders.length === 0 ? (
            <p className="px-6 py-4 text-sm text-agsi-darkGray">
              No stakeholders matched the period. Try regenerating, or check that there
              were level moves / engagements / documents in the date range.
            </p>
          ) : (
            <ul className="divide-y divide-agsi-lightGray">
              {stakeholders.map((s) => (
                <li key={s.id} className="px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      href={s.company_id ? `/companies/${s.company_id}` : '#'}
                      className="text-sm font-medium text-agsi-navy hover:underline"
                    >
                      {s.company_name_at_time}
                    </Link>
                    <LevelBadge level={s.level_at_time} />
                    {s.is_key_stakeholder && <Badge variant="gold">key</Badge>}
                    {s.moved_this_period && <Badge variant="green">moved</Badge>}
                    {s.flagged_stagnating && <Badge variant="amber">stagnating</Badge>}
                    {s.owner_name_at_time && (
                      <span className="text-xs text-agsi-darkGray">
                        owner · {s.owner_name_at_time}
                      </span>
                    )}
                  </div>
                  <div className="mt-2">
                    <StakeholderNarrativeEditor
                      rowId={s.id}
                      initial={s.narrative ?? ''}
                      disabled={!isDraft}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {isDraft && (
        <Card>
          <CardHeader>
            <CardTitle>Finalise</CardTitle>
            <CardDescription>
              Locks the report and sends an in-app notification to every active
              leadership user. After this, the executive summary, narratives, and
              payload are read-only.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <FinaliseButton reportId={report.id} />
          </CardContent>
        </Card>
      )}

      {(report.status === 'finalised' || report.status === 'archived') && (
        <Card>
          <CardHeader>
            <CardTitle>
              PDF snapshot{' '}
              {report.pdf_storage_path ? (
                <Badge variant="green">Persisted</Badge>
              ) : (
                <Badge variant="amber">Missing</Badge>
              )}
            </CardTitle>
            <CardDescription>
              {report.pdf_storage_path ? (
                <>
                  Captured at finalise time and stored in the{' '}
                  <code>leadership-reports</code> bucket. Downloads from{' '}
                  <Link
                    href={`/api/reports/leadership/${report.id}/pdf`}
                    className="text-agsi-accent hover:underline"
                  >
                    /api/reports/leadership/{report.id}/pdf
                  </Link>{' '}
                  redirect to a 60s signed URL. Click below to overwrite the
                  stored copy if the original render needs to be replaced.
                </>
              ) : (
                <>
                  No persisted PDF for this finalised report — the auto-render at
                  finalise time likely failed. Click below to render and upload it
                  now.
                </>
              )}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <RegeneratePdfButton reportId={report.id} />
          </CardContent>
        </Card>
      )}

      {report.status === 'finalised' && (
        <Card>
          <CardHeader>
            <CardTitle>Archive</CardTitle>
            <CardDescription>
              Move this report to the Archived bucket. Stays readable as audit-of-record;
              the spec disallows deletion.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ArchiveButton reportId={report.id} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function HeadlinesGrid({ headlines }: { headlines: Record<string, number> }) {
  const ORDER = [
    ['total_active_accounts', 'Total active accounts'],
    ['new_l3_this_period', 'New L3'],
    ['new_l4_this_period', 'New L4'],
    ['new_l5_this_period', 'New L5'],
    ['mous_signed', 'MOUs signed'],
    ['announcements', 'Announcements'],
    ['site_banners_installed', 'Site banners'],
    ['case_studies_published', 'Case studies'],
  ] as const;

  return (
    <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {ORDER.map(([key, label]) => (
        <div
          key={key}
          className="rounded-lg border border-agsi-lightGray bg-agsi-offWhite p-3"
        >
          <dt className="text-xs font-medium uppercase tracking-wide text-agsi-darkGray">
            {label}
          </dt>
          <dd className="mt-1 text-2xl font-semibold tabular-nums text-agsi-navy">
            {Number(headlines?.[key] ?? 0)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function PipelineSection({ payload }: { payload: LeadershipReportPayload }) {
  const fwd = payload.pipeline_movements?.forward_moves ?? [];
  const reg = payload.pipeline_movements?.regressions ?? [];
  return (
    <div className="space-y-4 text-sm">
      <div>
        <p className="mb-1 text-xs font-medium uppercase tracking-wide text-agsi-darkGray">
          Forward moves ({fwd.length})
        </p>
        {fwd.length === 0 ? (
          <p className="text-agsi-darkGray">None in period.</p>
        ) : (
          <ul className="space-y-1">
            {fwd.slice(0, 12).map((m, i) => (
              <li key={i} className="flex flex-wrap items-center gap-2 text-xs">
                <Link
                  href={`/companies/${m.company_id}`}
                  className="font-medium text-agsi-navy hover:underline"
                >
                  {m.company_name}
                </Link>
                <span className="text-agsi-darkGray">
                  {m.from_level} → {m.to_level}
                </span>
                <span className="text-agsi-darkGray">
                  {new Date(m.date).toISOString().slice(0, 10)}
                </span>
                {m.owner_name && (
                  <span className="text-agsi-darkGray">· {m.owner_name}</span>
                )}
              </li>
            ))}
            {fwd.length > 12 && (
              <li className="text-xs italic text-agsi-darkGray">
                +{fwd.length - 12} more in payload.
              </li>
            )}
          </ul>
        )}
      </div>
      <div>
        <p className="mb-1 text-xs font-medium uppercase tracking-wide text-agsi-darkGray">
          Regressions ({reg.length})
        </p>
        {reg.length === 0 ? (
          <p className="text-agsi-darkGray">None in period.</p>
        ) : (
          <ul className="space-y-1">
            {reg.slice(0, 6).map((m, i) => (
              <li key={i} className="text-xs text-agsi-darkGray">
                {m.company_name}: {m.from_level} → {m.to_level} (
                {new Date(m.date).toISOString().slice(0, 10)})
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

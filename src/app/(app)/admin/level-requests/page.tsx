import Link from 'next/link';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { serverComponentCookies } from '@/lib/supabase/cookie-adapter';
import { requireRole } from '@/lib/auth/require-role';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { LevelBadge } from '@/components/domain/LevelBadge';
import type { Level } from '@/types/domain';
import { ReviewActions } from './_components/ReviewActions';
import { EvidenceLinks } from './_components/EvidenceLinks';

export const dynamic = 'force-dynamic';

type Status = 'pending' | 'approved' | 'rejected' | 'cancelled';

type Row = {
  id: string;
  company_id: string;
  from_level: Level;
  to_level: Level;
  requested_at: string;
  evidence_note: string;
  evidence_file_paths: string[];
  status: Status;
  reviewed_at: string | null;
  review_note: string | null;
  requester: { full_name: string } | null;
  reviewer: { full_name: string } | null;
  company: { canonical_name: string } | null;
};

const STATUS_VARIANT: Record<Status, 'amber' | 'green' | 'red' | 'neutral'> = {
  pending: 'amber',
  approved: 'green',
  rejected: 'red',
  cancelled: 'neutral',
};

const STATUSES: Status[] = ['pending', 'approved', 'rejected', 'cancelled'];

export default async function LevelRequestsPage({
  searchParams,
}: {
  searchParams: { status?: string };
}) {
  await requireRole(['admin']);

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
    { cookies: serverComponentCookies(cookies()) },
  );

  const status = (STATUSES as readonly string[]).includes(searchParams.status ?? '')
    ? (searchParams.status as Status)
    : 'pending';

  const { data, error } = await supabase
    .from('level_change_requests')
    .select(
      'id, company_id, from_level, to_level, requested_at, evidence_note, evidence_file_paths, status, reviewed_at, review_note, requester:profiles!level_change_requests_requested_by_fkey(full_name), reviewer:profiles!level_change_requests_reviewed_by_fkey(full_name), company:companies(canonical_name)',
    )
    .eq('status', status)
    .order('requested_at', { ascending: false })
    .limit(200)
    .returns<Row[]>();

  const rows = data ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-agsi-navy">Level change requests</h1>
        <p className="mt-1 text-sm text-agsi-darkGray">
          Review submissions from BD managers and BD heads. Approving inserts the
          level_history row with the requester as changed_by and credits attribution
          accordingly.
        </p>
      </div>

      <div className="flex gap-2">
        {STATUSES.map((s) => (
          <Link
            key={s}
            href={`/admin/level-requests?status=${s}`}
            className={
              status === s
                ? 'rounded-lg bg-agsi-navy px-3 py-1 text-xs font-medium text-white'
                : 'rounded-lg border border-agsi-midGray px-3 py-1 text-xs font-medium text-agsi-navy hover:bg-agsi-lightGray/40'
            }
          >
            {s}
          </Link>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{rows.length} {status} request{rows.length === 1 ? '' : 's'}</CardTitle>
          <CardDescription>
            Approving runs <code>approve_level_change_request()</code> which inserts the
            level_history row + updates companies.current_level via the guard-bypass flag.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {error ? (
            <p className="p-4 text-sm text-rag-red">Failed to load: {error.message}</p>
          ) : rows.length === 0 ? (
            <p className="p-6 text-sm text-agsi-darkGray">
              No {status} requests.{' '}
              {status === 'pending' && 'All caught up — nothing waiting for your review.'}
            </p>
          ) : (
            <ul className="divide-y divide-agsi-lightGray">
              {rows.map((r) => (
                <li key={r.id} className="grid gap-4 px-4 py-4 lg:grid-cols-3">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <Link
                        href={`/companies/${r.company_id}` as never}
                        className="text-sm font-medium text-agsi-navy hover:underline"
                      >
                        {r.company?.canonical_name ?? r.company_id.slice(0, 8)}
                      </Link>
                      <Badge variant={STATUS_VARIANT[r.status]}>{r.status}</Badge>
                    </div>
                    <div className="flex items-center gap-2">
                      <LevelBadge level={r.from_level} />
                      <span className="text-agsi-darkGray">→</span>
                      <LevelBadge level={r.to_level} />
                    </div>
                    <p className="text-xs text-agsi-darkGray">
                      Requested by {r.requester?.full_name ?? 'Unknown'} ·{' '}
                      {new Date(r.requested_at).toLocaleString()}
                    </p>
                    {r.reviewed_at && (
                      <p className="text-xs text-agsi-darkGray">
                        Reviewed by {r.reviewer?.full_name ?? 'Unknown'} ·{' '}
                        {new Date(r.reviewed_at).toLocaleString()}
                        {r.review_note && (
                          <>
                            {' '}
                            · <em>&ldquo;{r.review_note}&rdquo;</em>
                          </>
                        )}
                      </p>
                    )}
                  </div>

                  <div className="space-y-1">
                    <p className="text-xs font-medium uppercase tracking-wider text-agsi-darkGray">
                      Evidence
                    </p>
                    <p className="whitespace-pre-wrap text-sm text-agsi-navy">
                      {r.evidence_note}
                    </p>
                    <EvidenceLinks paths={r.evidence_file_paths ?? []} />
                  </div>

                  <div>
                    {r.status === 'pending' ? (
                      <ReviewActions requestId={r.id} />
                    ) : (
                      <p className="text-xs italic text-agsi-darkGray">No further action.</p>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

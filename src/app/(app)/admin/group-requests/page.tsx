import Link from 'next/link';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { serverComponentCookies } from '@/lib/supabase/cookie-adapter';
import { requireRole } from '@/lib/auth/require-role';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { GroupRequestReviewActions } from './_components/GroupRequestReviewActions';

export const dynamic = 'force-dynamic';

type Status = 'pending' | 'approved' | 'rejected';

type Row = {
  id: string;
  parent_company_id: string;
  child_company_ids: string[];
  requested_by: string;
  requested_at: string;
  reason: string | null;
  status: Status;
  decided_by: string | null;
  decided_at: string | null;
  review_note: string | null;
  parent: { canonical_name: string } | { canonical_name: string }[] | null;
  requester: { full_name: string } | { full_name: string }[] | null;
  reviewer: { full_name: string } | { full_name: string }[] | null;
};

const STATUSES: Status[] = ['pending', 'approved', 'rejected'];
const STATUS_VARIANT: Record<Status, 'amber' | 'green' | 'neutral'> = {
  pending: 'amber',
  approved: 'green',
  rejected: 'neutral',
};

function pickOne<T>(v: T | T[] | null | undefined): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : (v ?? null);
}

export default async function GroupRequestsPage({
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

  const status = (STATUSES as readonly string[]).includes(
    searchParams.status ?? '',
  )
    ? (searchParams.status as Status)
    : 'pending';

  const { data: rowsRaw } = await supabase
    .from('company_group_requests')
    .select(
      'id, parent_company_id, child_company_ids, requested_by, requested_at, reason, status, decided_by, decided_at, review_note, parent:companies!company_group_requests_parent_company_id_fkey(canonical_name), requester:profiles!company_group_requests_requested_by_fkey(full_name), reviewer:profiles!company_group_requests_decided_by_fkey(full_name)',
    )
    .eq('status', status)
    .order('created_at', { ascending: false })
    .limit(200)
    .returns<Row[]>();
  const rows = rowsRaw ?? [];

  // Resolve child names for display in one query.
  const childIds = Array.from(
    new Set(rows.flatMap((r) => r.child_company_ids)),
  );
  type ChildRow = { id: string; canonical_name: string };
  let childNames = new Map<string, string>();
  if (childIds.length > 0) {
    const { data: cdata } = await supabase
      .from('companies')
      .select('id, canonical_name')
      .in('id', childIds)
      .returns<ChildRow[]>();
    childNames = new Map((cdata ?? []).map((c) => [c.id, c.canonical_name]));
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-agsi-navy">Group requests</h1>
        <p className="mt-1 text-sm text-agsi-darkGray">
          Pending grouping (holding-structure) requests. Approving sets
          parent_company_id on each child — non-destructive; nothing is
          hidden from search or counts.
        </p>
      </div>

      <div className="flex gap-2">
        {STATUSES.map((s) => (
          <Link
            key={s}
            href={`/admin/group-requests?status=${s}` as never}
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
          <CardTitle>
            {rows.length} {status} request{rows.length === 1 ? '' : 's'}
          </CardTitle>
          <CardDescription>
            Approve to apply the grouping atomically (each child gets
            parent_company_id set in one statement); reject with a reason.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {rows.length === 0 ? (
            <p className="p-6 text-sm text-agsi-darkGray">
              No {status} requests.
            </p>
          ) : (
            <ul className="divide-y divide-agsi-lightGray">
              {rows.map((r) => {
                const parent = pickOne(r.parent);
                const requester = pickOne(r.requester);
                const reviewer = pickOne(r.reviewer);
                return (
                  <li key={r.id} className="grid gap-4 px-4 py-4 lg:grid-cols-3">
                    <div className="lg:col-span-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant={STATUS_VARIANT[r.status]}>{r.status}</Badge>
                        <span className="text-xs text-agsi-darkGray">
                          {new Date(r.requested_at).toLocaleString()}
                        </span>
                      </div>
                      <p className="mt-1 text-sm">
                        Group <strong>{r.child_company_ids.length}</strong>{' '}
                        compan{r.child_company_ids.length === 1 ? 'y' : 'ies'} under{' '}
                        <Link
                          href={`/companies/${r.parent_company_id}` as never}
                          className="font-medium text-agsi-navy hover:underline"
                        >
                          {parent?.canonical_name ?? '(unnamed)'}
                        </Link>
                      </p>
                      <ul className="mt-2 flex flex-wrap gap-2 text-xs">
                        {r.child_company_ids.map((id) => (
                          <li
                            key={id}
                            className="inline-flex items-center rounded border border-agsi-lightGray bg-white px-2 py-0.5"
                          >
                            <Link
                              href={`/companies/${id}` as never}
                              className="text-agsi-navy hover:underline"
                            >
                              {childNames.get(id) ?? id.slice(0, 8) + '…'}
                            </Link>
                          </li>
                        ))}
                      </ul>
                      <p className="mt-2 text-xs text-agsi-darkGray">
                        Requested by {requester?.full_name ?? 'Unknown'}
                      </p>
                      {r.reason && (
                        <p className="mt-2 text-xs text-agsi-darkGray">
                          <em>“{r.reason}”</em>
                        </p>
                      )}
                      {r.status !== 'pending' && r.review_note && (
                        <p className="mt-2 text-xs text-agsi-darkGray">
                          <em>“{r.review_note}”</em>{' '}
                          · {reviewer?.full_name ?? 'admin'} ·{' '}
                          {r.decided_at
                            ? new Date(r.decided_at).toLocaleDateString()
                            : ''}
                        </p>
                      )}
                    </div>
                    <div>
                      {r.status === 'pending' ? (
                        <GroupRequestReviewActions requestId={r.id} />
                      ) : (
                        <p className="text-xs italic text-agsi-darkGray">
                          No further action.
                        </p>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

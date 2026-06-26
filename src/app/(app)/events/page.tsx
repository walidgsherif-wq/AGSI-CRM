import Link from 'next/link';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { serverComponentCookies } from '@/lib/supabase/cookie-adapter';
import { getCurrentUser } from '@/lib/auth/get-user';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/table';
import { Select } from '@/components/ui/select';
import { EVENT_TYPE_LABEL, type EventType } from '@/lib/zod/event';
import {
  fetchFiscalStartMonth,
  getFiscalContext,
} from '@/lib/fiscal';
import { EventLogForm } from '@/components/domain/EventLogForm';
import { EventRowActions } from './_components/EventRowActions';

export const dynamic = 'force-dynamic';

type Period = 'quarter' | 'fy' | 'all';

type EventRow = {
  id: string;
  member_id: string;
  event_name: string;
  event_date: string;
  event_type: EventType;
  website: string | null;
  value_note: string | null;
  feedback: string | null;
  member: { full_name: string } | { full_name: string }[] | null;
};

function pickOne<T>(v: T | T[] | null | undefined): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : (v ?? null);
}

export default async function EventsPage({
  searchParams,
}: {
  searchParams: { period?: string; member?: string };
}) {
  const user = await getCurrentUser();

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
    { cookies: serverComponentCookies(cookies()) },
  );

  const startMonth = await fetchFiscalStartMonth(supabase);
  const { fy, fq, quarters } = getFiscalContext(startMonth, new Date());

  const period: Period =
    searchParams.period === 'fy' || searchParams.period === 'all'
      ? searchParams.period
      : 'quarter';
  const memberFilter = searchParams.member ?? 'all';

  let fromDate: string | null = null;
  let toDate: string | null = null;
  if (period === 'quarter') {
    const cur = quarters.find((q) => q.status === 'in_progress') ?? quarters[3];
    fromDate = cur.startDate.toISOString().slice(0, 10);
    toDate = cur.endExclusive.toISOString().slice(0, 10);
  } else if (period === 'fy') {
    fromDate = quarters[0].startDate.toISOString().slice(0, 10);
    toDate = quarters[3].endExclusive.toISOString().slice(0, 10);
  }

  // Build filtered query.
  let q = supabase
    .from('event_attendance')
    .select(
      'id, member_id, event_name, event_date, event_type, website, value_note, feedback, member:profiles!event_attendance_member_id_fkey(full_name)',
    )
    .order('event_date', { ascending: false })
    .limit(500);
  if (fromDate) q = q.gte('event_date', fromDate);
  if (toDate) q = q.lt('event_date', toDate);
  if (memberFilter !== 'all') q = q.eq('member_id', memberFilter);
  const { data: rowsRaw } = await q.returns<EventRow[]>();
  const rows = rowsRaw ?? [];

  // Members list for the filter dropdown.
  const { data: profilesData } = await supabase
    .from('profiles')
    .select('id, full_name')
    .eq('is_active', true)
    .order('full_name');
  const profiles = (profilesData ?? []) as Array<{
    id: string;
    full_name: string;
  }>;

  // Per-member counts for the rollup strip.
  const perMember = new Map<string, number>();
  for (const r of rows) {
    perMember.set(r.member_id, (perMember.get(r.member_id) ?? 0) + 1);
  }
  const perMemberSorted = Array.from(perMember.entries())
    .map(([id, count]) => ({
      id,
      name: profiles.find((p) => p.id === id)?.full_name ?? 'Unknown',
      count,
    }))
    .sort((a, b) => b.count - a.count);

  const periodLabel =
    period === 'quarter'
      ? `FY${fy} Q${fq}`
      : period === 'fy'
        ? `FY${fy}`
        : 'All time';

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-agsi-navy">Team events</h1>
          <p className="mt-1 text-sm text-agsi-darkGray">
            Conferences, exhibitions, and CPD the BD team has attended. Each
            member logs their own.
          </p>
        </div>
        <EventLogForm
          mode="create"
          trigger={<Button size="sm">+ Log event</Button>}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Filter</CardTitle>
          <CardDescription>
            Period and member. Showing <strong>{rows.length}</strong> events
            in {periodLabel}.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="grid gap-3 sm:grid-cols-4">
            <div>
              <label className="block text-xs font-medium text-agsi-darkGray">
                Period
              </label>
              <Select name="period" defaultValue={period} className="mt-1">
                <option value="quarter">This quarter (FY{fy} Q{fq})</option>
                <option value="fy">This fiscal year (FY{fy})</option>
                <option value="all">All time</option>
              </Select>
            </div>
            <div>
              <label className="block text-xs font-medium text-agsi-darkGray">
                Member
              </label>
              <Select name="member" defaultValue={memberFilter} className="mt-1">
                <option value="all">All members</option>
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.full_name}
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex items-end">
              <Button type="submit" variant="secondary" className="w-full">
                Apply
              </Button>
            </div>
            <div className="flex items-end">
              <Link
                href={'/events' as never}
                className="text-xs text-agsi-darkGray hover:underline"
              >
                Reset
              </Link>
            </div>
          </form>
        </CardContent>
      </Card>

      {perMemberSorted.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>By member · {periodLabel}</CardTitle>
            <CardDescription>
              {perMemberSorted.length} members logged at least one event.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-wrap gap-2 text-xs">
              {perMemberSorted.map((m) => (
                <li
                  key={m.id}
                  className="inline-flex items-center gap-1.5 rounded-full border border-agsi-lightGray bg-white px-3 py-1"
                >
                  <span className="font-medium text-agsi-navy">{m.name}</span>
                  <span className="text-agsi-darkGray">·</span>
                  <span className="tabular-nums text-agsi-darkGray">
                    {m.count}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-0">
          {rows.length === 0 ? (
            <p className="p-6 text-sm text-agsi-darkGray">
              No events match these filters.
            </p>
          ) : (
            <Table className="min-w-[720px]">
              <THead>
                <TR head>
                  <TH className="px-4">Member</TH>
                  <TH className="px-4">Event</TH>
                  <TH className="px-4">Date</TH>
                  <TH className="px-4">Type</TH>
                  <TH className="px-4">Value note</TH>
                  <TH className="px-4">Feedback</TH>
                  <TH className="px-4"></TH>
                </TR>
              </THead>
              <TBody>
                {rows.map((r) => {
                  const memberName =
                    pickOne(r.member)?.full_name ?? 'Unknown';
                  const canMutate =
                    user.role === 'admin' || r.member_id === user.id;
                  return (
                    <TR key={r.id} className="hover:bg-agsi-lightGray/20">
                      <TD className="px-4 font-medium text-agsi-navy">
                        {memberName}
                      </TD>
                      <TD className="px-4">
                        <div className="text-agsi-navy">{r.event_name}</div>
                        {r.website && (
                          <a
                            href={r.website}
                            target="_blank"
                            rel="noreferrer noopener"
                            className="text-xs2 text-agsi-accent hover:underline"
                          >
                            {r.website}
                          </a>
                        )}
                      </TD>
                      <TD className="px-4 text-agsi-darkGray tabular-nums">
                        {r.event_date}
                      </TD>
                      <TD className="px-4">
                        <Badge variant="blue">
                          {EVENT_TYPE_LABEL[r.event_type]}
                        </Badge>
                      </TD>
                      <TD className="px-4 text-xs text-agsi-darkGray">
                        {r.value_note ?? '—'}
                      </TD>
                      <TD className="px-4 text-xs text-agsi-darkGray">
                        {r.feedback ?? '—'}
                      </TD>
                      <TD className="px-4">
                        {canMutate && (
                          <EventRowActions
                            row={{
                              id: r.id,
                              event_name: r.event_name,
                              event_date: r.event_date,
                              event_type: r.event_type,
                              website: r.website,
                              value_note: r.value_note,
                              feedback: r.feedback,
                            }}
                          />
                        )}
                      </TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

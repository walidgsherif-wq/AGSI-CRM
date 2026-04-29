import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { serverComponentCookies } from '@/lib/supabase/cookie-adapter';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { RebuildActions } from './_components/RebuildActions';

export const dynamic = 'force-dynamic';

type Snapshot = {
  snapshot_date: string;
  lifetime_score: number;
  active_score: number;
  theoretical_max: number;
  lifetime_pct: number;
  active_pct: number;
  computed_at: string;
};

export default async function EcosystemRebuildPage() {
  // Layout already gates to admin role.
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
    { cookies: serverComponentCookies(cookies()) },
  );

  const { data: snapshot } = await supabase
    .from('ecosystem_awareness_current')
    .select(
      'snapshot_date, lifetime_score, active_score, theoretical_max, lifetime_pct, active_pct, computed_at',
    )
    .order('snapshot_date', { ascending: false })
    .limit(1)
    .maybeSingle<Snapshot>();

  const { count: eventCount } = await supabase
    .from('ecosystem_events')
    .select('id', { count: 'exact', head: true })
    .eq('is_void', false);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-agsi-navy">Ecosystem rebuild</h1>
        <p className="mt-1 text-sm text-agsi-darkGray">
          Recompute the ecosystem awareness daily snapshot, or backfill historical
          engagement / level / document events into the ecosystem ledger.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Latest snapshot</CardTitle>
          <CardDescription>
            From <code>ecosystem_awareness_current</code>. Recomputed on demand or by the
            nightly cron at 22:15 UTC.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!snapshot ? (
            <p className="text-sm text-agsi-darkGray">
              No snapshot yet. Run <strong>Rebuild now</strong> below.
            </p>
          ) : (
            <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Stat label="Snapshot date" value={snapshot.snapshot_date} />
              <Stat
                label="Lifetime score"
                value={`${num(snapshot.lifetime_score)} / ${num(snapshot.theoretical_max)}`}
                hint={`${num(snapshot.lifetime_pct)}% of theoretical max`}
              />
              <Stat
                label="Active (90d) score"
                value={`${num(snapshot.active_score)} / ${num(snapshot.theoretical_max)}`}
                hint={`${num(snapshot.active_pct)}%`}
              />
              <Stat
                label="Computed at"
                value={new Date(snapshot.computed_at).toLocaleString(undefined, {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                })}
              />
            </dl>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Event ledger</CardTitle>
          <CardDescription>
            All non-void rows in <code>ecosystem_events</code>. New events fire automatically
            via triggers on <code>level_history</code>, <code>engagements</code>,
            and <code>documents</code>.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Stat label="Total live events" value={String(eventCount ?? 0)} />
        </CardContent>
      </Card>

      <RebuildActions />
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-agsi-lightGray bg-agsi-offWhite p-3">
      <dt className="text-xs font-medium uppercase tracking-wide text-agsi-darkGray">
        {label}
      </dt>
      <dd className="mt-1 text-lg font-semibold text-agsi-navy">{value}</dd>
      {hint && <p className="mt-0.5 text-xs text-agsi-darkGray">{hint}</p>}
    </div>
  );
}

function num(n: number): string {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(n);
}

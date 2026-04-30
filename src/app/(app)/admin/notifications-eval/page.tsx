import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { serverComponentCookies } from '@/lib/supabase/cookie-adapter';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EvalActions } from './_components/EvalActions';

export const dynamic = 'force-dynamic';

type RecentRow = {
  notification_type: string;
  count: number;
};

export default async function NotificationsEvalPage() {
  // Admin layout already enforces requireRole(['admin']).
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
    { cookies: serverComponentCookies(cookies()) },
  );

  // Last 24 hours of notification firings broken down by type.
  const { data } = await supabase
    .from('notifications')
    .select('notification_type, created_at')
    .gte('created_at', new Date(Date.now() - 86_400_000).toISOString())
    .returns<{ notification_type: string; created_at: string }[]>();

  const rows: RecentRow[] = (() => {
    const counts = new Map<string, number>();
    for (const r of data ?? []) {
      counts.set(r.notification_type, (counts.get(r.notification_type) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([notification_type, count]) => ({ notification_type, count }))
      .sort((a, b) => b.count - a.count);
  })();

  // Stagnation rules summary so admin can sanity-check thresholds.
  const { data: rulesData } = await supabase
    .from('stagnation_rules')
    .select('level, max_days_in_level, warn_at_pct, escalation_role')
    .eq('is_active', true)
    .order('level')
    .returns<
      Array<{
        level: string;
        max_days_in_level: number;
        warn_at_pct: number;
        escalation_role: string;
      }>
    >();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-agsi-navy">Notifications eval</h1>
        <p className="mt-1 text-sm text-agsi-darkGray">
          Manually trigger the M13 evaluation jobs (stagnation, composition warning,
          composition drift). v1 has no cron wrappers — clicking the buttons below
          inserts the same notifications a scheduled job would.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Last 24h fan-out</CardTitle>
          <CardDescription>
            Notification rows created in the last 24h (any source, including the M5/M9/
            M12 flows, not just these eval jobs).
          </CardDescription>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <p className="text-sm text-agsi-darkGray">
              No notifications in the last 24h.
            </p>
          ) : (
            <ul className="divide-y divide-agsi-lightGray text-sm">
              {rows.map((r) => (
                <li
                  key={r.notification_type}
                  className="flex items-center justify-between py-1.5"
                >
                  <span className="font-mono text-agsi-navy">
                    {r.notification_type}
                  </span>
                  <span className="tabular-nums text-agsi-darkGray">{r.count}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <EvalActions />

      <Card>
        <CardHeader>
          <CardTitle>Stagnation thresholds</CardTitle>
          <CardDescription>
            From <code>stagnation_rules</code>. Edit there if a level&apos;s threshold
            needs to change.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!rulesData || rulesData.length === 0 ? (
            <p className="text-sm text-agsi-darkGray">No active rules.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-agsi-darkGray">
                  <th className="py-1">Level</th>
                  <th className="py-1">Max days</th>
                  <th className="py-1">Warn at</th>
                  <th className="py-1">Escalation</th>
                </tr>
              </thead>
              <tbody>
                {rulesData.map((r) => (
                  <tr key={r.level} className="border-t border-agsi-lightGray">
                    <td className="py-1 font-medium text-agsi-navy">{r.level}</td>
                    <td className="py-1 tabular-nums">{r.max_days_in_level}</td>
                    <td className="py-1 tabular-nums">{r.warn_at_pct}%</td>
                    <td className="py-1 text-agsi-darkGray">{r.escalation_role}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

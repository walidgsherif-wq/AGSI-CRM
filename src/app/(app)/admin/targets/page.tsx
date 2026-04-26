import Link from 'next/link';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { serverComponentCookies } from '@/lib/supabase/cookie-adapter';
import { requireRole } from '@/lib/auth/require-role';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { TargetRow } from './_components/TargetRow';

export const dynamic = 'force-dynamic';

type Driver = 'A' | 'B' | 'C' | 'D';

type PlaybookTargetRow = {
  metric_code: string;
  metric_label: string;
  driver: Driver;
  q1_target: number;
  q2_target: number;
  q3_target: number;
  q4_target: number;
};

type MemberTargetRow = {
  user_id: string;
  metric_code: string;
  q1_target: number;
  q2_target: number;
  q3_target: number;
  q4_target: number;
};

type ProfileRow = { id: string; full_name: string; role: string; is_active: boolean };

export default async function AdminTargetsPage({
  searchParams,
}: {
  searchParams: { user?: string; fy?: string };
}) {
  await requireRole(['admin']);

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
    { cookies: serverComponentCookies(cookies()) },
  );

  const fy = parseInt(searchParams.fy ?? String(new Date().getUTCFullYear()), 10);

  const { data: profilesData } = await supabase
    .from('profiles')
    .select('id, full_name, role, is_active')
    .in('role', ['bd_manager', 'bd_head'])
    .eq('is_active', true)
    .order('full_name')
    .returns<ProfileRow[]>();
  const profiles = profilesData ?? [];

  const selectedUserId = searchParams.user ?? profiles[0]?.id ?? null;
  const selectedUser = profiles.find((p) => p.id === selectedUserId) ?? null;

  const { data: playbook } = await supabase
    .from('playbook_targets')
    .select('metric_code, metric_label, driver, q1_target, q2_target, q3_target, q4_target')
    .eq('fiscal_year', fy)
    .order('driver', { ascending: true })
    .order('metric_code', { ascending: true })
    .returns<PlaybookTargetRow[]>();

  const { data: overrides } = selectedUserId
    ? await supabase
        .from('member_targets')
        .select('user_id, metric_code, q1_target, q2_target, q3_target, q4_target')
        .eq('user_id', selectedUserId)
        .eq('fiscal_year', fy)
        .returns<MemberTargetRow[]>()
    : { data: [] as MemberTargetRow[] };
  const overrideByMetric = new Map((overrides ?? []).map((o) => [o.metric_code, o]));

  const grouped: Record<Driver, PlaybookTargetRow[]> = { A: [], B: [], C: [], D: [] };
  for (const m of playbook ?? []) grouped[m.driver].push(m);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-agsi-navy">Targets</h1>
        <p className="mt-1 text-sm text-agsi-darkGray">
          Playbook defaults per FY, per-member overrides per BDM. Edit a row to override;
          reset clears the override and falls back to the playbook value.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Pick a member</CardTitle>
          <CardDescription>FY{fy} targets shown below for the selected user.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-center gap-2">
            {profiles.map((p) => (
              <Link
                key={p.id}
                href={`/admin/targets?user=${p.id}&fy=${fy}`}
                className={
                  p.id === selectedUserId
                    ? 'rounded border border-agsi-navy bg-agsi-navy px-3 py-1 text-xs font-medium text-white'
                    : 'rounded border border-agsi-midGray px-3 py-1 text-xs font-medium text-agsi-navy hover:bg-agsi-lightGray/40'
                }
              >
                {p.full_name}
                {p.role === 'bd_head' && (
                  <Badge variant="blue" className="ml-1">
                    Head
                  </Badge>
                )}
              </Link>
            ))}
            {profiles.length === 0 && (
              <p className="text-sm text-agsi-darkGray">
                No active bd_manager / bd_head profiles. Invite one via /admin/users.
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {selectedUser && (
        <div className="space-y-4">
          {(['A', 'B', 'C', 'D'] as Driver[]).map((d) => (
            <Card key={d}>
              <CardHeader>
                <CardTitle>Driver {d}</CardTitle>
                <CardDescription>
                  {selectedUser.full_name} — FY{fy}. Edit per quarter; values save on Save.
                </CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                {grouped[d].length === 0 ? (
                  <p className="p-6 text-sm text-agsi-darkGray">No metrics seeded.</p>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-agsi-lightGray text-left text-xs uppercase tracking-wider text-agsi-darkGray">
                        <th className="px-4 py-2 font-medium">Metric</th>
                        <th className="px-2 py-2 font-medium tabular">Q1</th>
                        <th className="px-2 py-2 font-medium tabular">Q2</th>
                        <th className="px-2 py-2 font-medium tabular">Q3</th>
                        <th className="px-2 py-2 font-medium tabular">Q4</th>
                        <th className="px-4 py-2 font-medium tabular">Annual</th>
                        <th className="px-4 py-2 font-medium"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {grouped[d].map((m) => {
                        const override = overrideByMetric.get(m.metric_code) ?? null;
                        const playbookQ: [number, number, number, number] = [
                          Number(m.q1_target),
                          Number(m.q2_target),
                          Number(m.q3_target),
                          Number(m.q4_target),
                        ];
                        const overrideQ = override
                          ? ([
                              Number(override.q1_target),
                              Number(override.q2_target),
                              Number(override.q3_target),
                              Number(override.q4_target),
                            ] as [number, number, number, number])
                          : null;
                        return (
                          <TargetRow
                            key={m.metric_code}
                            userId={selectedUser.id}
                            fiscalYear={fy}
                            metricCode={m.metric_code}
                            metricLabel={m.metric_label}
                            playbookQ={playbookQ}
                            override={overrideQ}
                          />
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

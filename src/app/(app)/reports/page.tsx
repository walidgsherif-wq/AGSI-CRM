import Link from 'next/link';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { serverComponentCookies } from '@/lib/supabase/cookie-adapter';
import { requireRole } from '@/lib/auth/require-role';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ROLE_LABEL } from '@/types/domain';

export const dynamic = 'force-dynamic';

type Profile = {
  id: string;
  full_name: string;
  role: 'admin' | 'leadership' | 'bd_head' | 'bd_manager';
};

export default async function ReportsHubPage() {
  await requireRole(['admin', 'leadership', 'bd_head']);

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
    { cookies: serverComponentCookies(cookies()) },
  );

  const { data } = await supabase
    .from('profiles')
    .select('id, full_name, role')
    .in('role', ['bd_manager', 'bd_head'])
    .eq('is_active', true)
    .order('full_name')
    .returns<Profile[]>();
  const members = data ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-agsi-navy">Reports</h1>
        <p className="mt-1 text-sm text-agsi-darkGray">
          Performance review by member; quarterly scorecard and leadership reports
          archive land in M12.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Performance review by member</CardTitle>
          <CardDescription>
            Multi-quarter drill-down per BDM: KPI actuals vs target across all four quarters,
            stakeholder composition, engagement freshness, and the level-change ledger.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {members.length === 0 ? (
            <p className="text-sm text-agsi-darkGray">
              No active BD profiles. Invite via /admin/users.
            </p>
          ) : (
            <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {members.map((m) => (
                <li key={m.id}>
                  <Link
                    href={`/reports/performance-review/${m.id}`}
                    className="flex items-center justify-between rounded-lg border border-agsi-lightGray bg-white px-3 py-2 text-sm hover:border-agsi-navy hover:bg-agsi-offWhite"
                  >
                    <span className="font-medium text-agsi-navy">{m.full_name}</span>
                    <Badge variant={m.role === 'bd_head' ? 'blue' : 'neutral'}>
                      {ROLE_LABEL[m.role]}
                    </Badge>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Quarterly scorecard</CardTitle>
          <CardDescription>Cross-team summary. Lands in M15.</CardDescription>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Leadership reports archive</CardTitle>
          <CardDescription>
            Monthly + quarterly strategic reports — frozen snapshots with the
            leadership feedback loop.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Link
            href={'/reports/leadership' as never}
            className="inline-flex items-center text-sm font-medium text-agsi-accent hover:underline"
          >
            Open archive →
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}

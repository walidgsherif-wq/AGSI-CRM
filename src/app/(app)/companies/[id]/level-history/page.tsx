import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { serverComponentCookies } from '@/lib/supabase/cookie-adapter';
import { getCurrentUser } from '@/lib/auth/get-user';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { LevelBadge } from '@/components/domain/LevelBadge';
import type { Level } from '@/types/domain';
import { CreditToggle } from './_components/CreditToggle';

export const dynamic = 'force-dynamic';

type HistoryRow = {
  id: string;
  from_level: Level;
  to_level: Level;
  changed_at: string;
  fiscal_year: number;
  fiscal_quarter: number;
  evidence_note: string | null;
  evidence_file_url: string | null;
  is_forward: boolean;
  is_credited: boolean;
  changed_by: string | null;
  owner_at_time: string | null;
  changed_by_profile: { full_name: string } | null;
  owner_at_time_profile: { full_name: string } | null;
};

export default async function CompanyLevelHistoryTab({ params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
    { cookies: serverComponentCookies(cookies()) },
  );

  const { data } = await supabase
    .from('level_history')
    .select(
      'id, from_level, to_level, changed_at, fiscal_year, fiscal_quarter, evidence_note, evidence_file_url, is_forward, is_credited, changed_by, owner_at_time, changed_by_profile:profiles!level_history_changed_by_fkey(full_name), owner_at_time_profile:profiles!level_history_owner_at_time_fkey(full_name)',
    )
    .eq('company_id', params.id)
    .order('changed_at', { ascending: false })
    .limit(200)
    .returns<HistoryRow[]>();

  const rows = data ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Level history</CardTitle>
        <CardDescription>
          Immutable ledger. Every L change writes a row. Admin can toggle &quot;credited&quot; to
          exclude a row from KPI rollup (e.g. backward move appeals).
        </CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        {rows.length === 0 ? (
          <p className="p-6 text-sm text-agsi-darkGray">
            No level changes recorded yet. Move this company on the Pipeline page or via the
            Overview header to start the ledger.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-agsi-lightGray text-left text-xs uppercase tracking-wider text-agsi-darkGray">
                <th className="px-4 py-2 font-medium">When</th>
                <th className="px-4 py-2 font-medium">Move</th>
                <th className="px-4 py-2 font-medium">By</th>
                <th className="px-4 py-2 font-medium">Owner credited</th>
                <th className="px-4 py-2 font-medium">FY</th>
                <th className="px-4 py-2 font-medium">Evidence</th>
                <th className="px-4 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-agsi-lightGray/50">
                  <td className="px-4 py-3 text-agsi-darkGray">
                    {new Date(r.changed_at).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <LevelBadge level={r.from_level} />
                      <span className="text-agsi-darkGray">→</span>
                      <LevelBadge level={r.to_level} />
                    </div>
                  </td>
                  <td className="px-4 py-3 text-agsi-darkGray">
                    {r.changed_by_profile?.full_name ?? 'System'}
                  </td>
                  <td className="px-4 py-3 text-agsi-darkGray">
                    {r.owner_at_time_profile?.full_name ?? 'Unassigned'}
                  </td>
                  <td className="px-4 py-3 tabular text-agsi-darkGray">
                    {r.fiscal_year} Q{r.fiscal_quarter}
                  </td>
                  <td className="px-4 py-3">
                    {r.evidence_note ? (
                      <div className="max-w-xs text-xs text-agsi-darkGray">
                        {r.evidence_note}
                        {r.evidence_file_url && (
                          <a
                            href={r.evidence_file_url}
                            target="_blank"
                            rel="noreferrer"
                            className="ml-1 text-agsi-accent hover:underline"
                          >
                            ↗
                          </a>
                        )}
                      </div>
                    ) : (
                      <span className="text-xs text-agsi-darkGray">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {!r.is_forward && (
                      <Badge variant="amber" className="mr-2">
                        Backward
                      </Badge>
                    )}
                    {user.role === 'admin' ? (
                      <CreditToggle historyId={r.id} isCredited={r.is_credited} />
                    ) : r.is_credited ? (
                      <Badge variant="green">Credited</Badge>
                    ) : (
                      <Badge variant="neutral">Uncredited</Badge>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  );
}

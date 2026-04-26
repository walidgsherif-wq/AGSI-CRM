import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { serverComponentCookies } from '@/lib/supabase/cookie-adapter';
import { getCurrentUser } from '@/lib/auth/get-user';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { TransferForm } from './_components/TransferForm';

export const dynamic = 'force-dynamic';

type CompanyRow = {
  id: string;
  owner_id: string | null;
  owner_assigned_at: string | null;
  owner: { full_name: string } | null;
};

type AuditRow = {
  id: string;
  occurred_at: string;
  actor_id: string | null;
  before_json: { old_owner_id?: string; new_owner_id?: string } | null;
  after_json: { transfer_credit?: boolean; history_rows_reattributed?: number } | null;
  actor: { full_name: string } | null;
};

type ProfileRow = { id: string; full_name: string; role: string };

export default async function CompanyOwnershipTimelineTab({
  params,
}: {
  params: { id: string };
}) {
  const user = await getCurrentUser();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
    { cookies: serverComponentCookies(cookies()) },
  );

  const [companyRes, profilesRes, auditRes] = await Promise.all([
    supabase
      .from('companies')
      .select(
        'id, owner_id, owner_assigned_at, owner:profiles!companies_owner_id_fkey(full_name)',
      )
      .eq('id', params.id)
      .single<CompanyRow>(),
    supabase
      .from('profiles')
      .select('id, full_name, role')
      .eq('is_active', true)
      .order('full_name')
      .returns<ProfileRow[]>(),
    user.role === 'admin'
      ? supabase
          .from('audit_events')
          .select(
            'id, occurred_at, actor_id, before_json, after_json, actor:profiles!audit_events_actor_id_fkey(full_name)',
          )
          .eq('event_type', 'ownership_transfer')
          .eq('entity_id', params.id)
          .order('occurred_at', { ascending: false })
          .limit(50)
          .returns<AuditRow[]>()
      : Promise.resolve({ data: [] as AuditRow[] }),
  ]);

  const company = companyRes.data;
  const profiles = profilesRes.data ?? [];
  const auditEvents = auditRes.data ?? [];

  const profilesById = new Map(profiles.map((p) => [p.id, p.full_name]));

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Current owner</CardTitle>
          <CardDescription>
            §16 D-8 — admin can transfer ownership and choose whether to reattribute the
            credit history.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="text-sm">
            <p className="text-agsi-navy">
              <strong>{company?.owner?.full_name ?? 'Unassigned'}</strong>
            </p>
            {company?.owner_assigned_at && (
              <p className="text-xs text-agsi-darkGray">
                Assigned {new Date(company.owner_assigned_at).toLocaleString()}
              </p>
            )}
          </div>
          {user.role === 'admin' && company && (
            <TransferForm
              companyId={company.id}
              currentOwnerId={company.owner_id}
              profiles={profiles}
            />
          )}
          {user.role !== 'admin' && (
            <p className="text-xs text-agsi-darkGray">
              Only admins can transfer ownership.
            </p>
          )}
        </CardContent>
      </Card>

      {user.role === 'admin' && (
        <Card>
          <CardHeader>
            <CardTitle>Transfer history</CardTitle>
            <CardDescription>
              {auditEvents.length} transfer{auditEvents.length === 1 ? '' : 's'} on record.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {auditEvents.length === 0 ? (
              <p className="p-6 text-sm text-agsi-darkGray">No transfers yet.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-agsi-lightGray text-left text-xs uppercase tracking-wider text-agsi-darkGray">
                    <th className="px-4 py-2 font-medium">When</th>
                    <th className="px-4 py-2 font-medium">By</th>
                    <th className="px-4 py-2 font-medium">From</th>
                    <th className="px-4 py-2 font-medium">To</th>
                    <th className="px-4 py-2 font-medium">Credit</th>
                    <th className="px-4 py-2 font-medium">Rows</th>
                  </tr>
                </thead>
                <tbody>
                  {auditEvents.map((a) => (
                    <tr key={a.id} className="border-b border-agsi-lightGray/50">
                      <td className="px-4 py-3 text-agsi-darkGray">
                        {new Date(a.occurred_at).toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-agsi-darkGray">
                        {a.actor?.full_name ?? 'System'}
                      </td>
                      <td className="px-4 py-3 text-agsi-darkGray">
                        {a.before_json?.old_owner_id
                          ? profilesById.get(a.before_json.old_owner_id) ??
                            a.before_json.old_owner_id.slice(0, 8)
                          : '—'}
                      </td>
                      <td className="px-4 py-3 text-agsi-darkGray">
                        {a.before_json?.new_owner_id
                          ? profilesById.get(a.before_json.new_owner_id) ??
                            a.before_json.new_owner_id.slice(0, 8)
                          : '—'}
                      </td>
                      <td className="px-4 py-3 text-agsi-darkGray">
                        {a.after_json?.transfer_credit ? 'Transferred' : 'Preserved prior owner'}
                      </td>
                      <td className="px-4 py-3 tabular text-agsi-darkGray">
                        {a.after_json?.history_rows_reattributed ?? 0}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

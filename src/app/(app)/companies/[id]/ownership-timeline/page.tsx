import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { serverComponentCookies } from '@/lib/supabase/cookie-adapter';
import { getCurrentUser } from '@/lib/auth/get-user';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/table';
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
              <Table>
                <THead>
                  <TR head>
                    <TH className="px-4">When</TH>
                    <TH className="px-4">By</TH>
                    <TH className="px-4">From</TH>
                    <TH className="px-4">To</TH>
                    <TH className="px-4">Credit</TH>
                    <TH className="px-4">Rows</TH>
                  </TR>
                </THead>
                <TBody>
                  {auditEvents.map((a) => (
                    <TR key={a.id}>
                      <TD className="px-4 text-agsi-darkGray">
                        {new Date(a.occurred_at).toLocaleString()}
                      </TD>
                      <TD className="px-4 text-agsi-darkGray">
                        {a.actor?.full_name ?? 'System'}
                      </TD>
                      <TD className="px-4 text-agsi-darkGray">
                        {a.before_json?.old_owner_id
                          ? profilesById.get(a.before_json.old_owner_id) ??
                            a.before_json.old_owner_id.slice(0, 8)
                          : '—'}
                      </TD>
                      <TD className="px-4 text-agsi-darkGray">
                        {a.before_json?.new_owner_id
                          ? profilesById.get(a.before_json.new_owner_id) ??
                            a.before_json.new_owner_id.slice(0, 8)
                          : '—'}
                      </TD>
                      <TD className="px-4 text-agsi-darkGray">
                        {a.after_json?.transfer_credit ? 'Transferred' : 'Preserved prior owner'}
                      </TD>
                      <TD className="px-4 tabular text-agsi-darkGray">
                        {a.after_json?.history_rows_reattributed ?? 0}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

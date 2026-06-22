import Link from 'next/link';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { requireRole } from '@/lib/auth/require-role';
import { getCurrentUser } from '@/lib/auth/get-user';
import { serverComponentCookies } from '@/lib/supabase/cookie-adapter';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/table';
import { InviteUserForm } from './_components/InviteUserForm';
import { UserRoleActions } from './_components/UserRoleActions';
import {
  PendingInvitationsList,
  type PendingInvite,
} from './_components/PendingInvitationsList';
import { CopyLoginLinkButton } from './_components/CopyLoginLinkButton';
import { ROLE_LABEL } from '@/types/domain';

export const dynamic = 'force-dynamic';

type ProfileRow = {
  id: string;
  full_name: string;
  email: string;
  role: 'admin' | 'leadership' | 'bd_head' | 'bd_manager';
  is_active: boolean;
  created_at: string;
  invited_at: string | null;
};

export default async function AdminUsersPage() {
  await requireRole(['admin']);
  const caller = await getCurrentUser();

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: serverComponentCookies(cookies()) },
  );

  const [{ data: users, error }, { data: invites }] = await Promise.all([
    supabase
      .from('profiles')
      .select('id, full_name, email, role, is_active, created_at, invited_at')
      .order('created_at', { ascending: false })
      .returns<ProfileRow[]>(),
    supabase
      .from('invited_users')
      .select('email, role, full_name, invited_at')
      .order('invited_at', { ascending: false })
      .returns<PendingInvite[]>(),
  ]);
  const pendingInvites = invites ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-agsi-navy">Users</h1>
          <p className="mt-1 text-sm text-agsi-darkGray">
            Add teammates, promote to admin/lead, deactivate when they leave.
            No email is sent — copy the login link and share it directly.
          </p>
        </div>
        <CopyLoginLinkButton />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Add a new user</CardTitle>
          <CardDescription>
            Adds them to the allow-list at the selected role. No email is sent — share
            the login link (button top-right) and tell them to sign in with their Google
            account using this exact email.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <InviteUserForm />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Pending invitations</CardTitle>
          <CardDescription>
            Added via the form above. Each row clears automatically when the
            invitee signs in with Google for the first time. Revoke to remove an
            entry that should no longer stand.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <PendingInvitationsList invites={pendingInvites} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Team</CardTitle>
          <CardDescription>{users?.length ?? 0} active and deactivated users.</CardDescription>
        </CardHeader>
        <CardContent>
          {error ? (
            <p className="text-sm text-rag-red">Failed to load users: {error.message}</p>
          ) : !users || users.length === 0 ? (
            <p className="text-sm text-agsi-darkGray">No users yet.</p>
          ) : (
            <Table className="min-w-[640px]">
              <THead>
                <TR head>
                  <TH>Name</TH>
                  <TH>Email</TH>
                  <TH>Role</TH>
                  <TH>Status</TH>
                  <TH></TH>
                </TR>
              </THead>
              <TBody>
                {users.map((u) => (
                  <TR key={u.id}>
                    <TD className="font-medium text-agsi-navy">{u.full_name}</TD>
                    <TD className="text-agsi-darkGray">{u.email}</TD>
                    <TD>
                      <Badge
                        variant={
                          u.role === 'admin'
                            ? 'purple'
                            : u.role === 'leadership'
                              ? 'gold'
                              : u.role === 'bd_head'
                                ? 'blue'
                                : 'neutral'
                        }
                      >
                        {ROLE_LABEL[u.role]}
                      </Badge>
                    </TD>
                    <TD>
                      {u.is_active ? (
                        <Badge variant="green">Active</Badge>
                      ) : (
                        <Badge variant="red">Deactivated</Badge>
                      )}
                    </TD>
                    <TD className="text-right">
                      <div className="flex items-center justify-end gap-3">
                        {u.role !== 'admin' && (
                          <Link
                            href={`/admin/users/${u.id}/access` as never}
                            className="text-xs font-medium text-agsi-accent hover:underline"
                          >
                            Manage access
                          </Link>
                        )}
                        <UserRoleActions
                          userId={u.id}
                          currentRole={u.role}
                          isActive={u.is_active}
                          canDelete={u.id !== caller.id}
                          email={u.email}
                          fullName={u.full_name}
                        />
                      </div>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

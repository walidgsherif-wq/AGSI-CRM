import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { requireRole } from '@/lib/auth/require-role';
import { serverComponentCookies } from '@/lib/supabase/cookie-adapter';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { InviteUserForm } from './_components/InviteUserForm';
import { UserRoleActions } from './_components/UserRoleActions';
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

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: serverComponentCookies(cookies()) },
  );

  const { data: users, error } = await supabase
    .from('profiles')
    .select('id, full_name, email, role, is_active, created_at, invited_at')
    .order('created_at', { ascending: false })
    .returns<ProfileRow[]>();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-agsi-navy">Users</h1>
          <p className="mt-1 text-sm text-agsi-darkGray">
            Invite teammates, promote to admin/lead, deactivate when they leave.
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Invite a new user</CardTitle>
          <CardDescription>
            They&apos;ll receive a magic-link email from Supabase. On first sign-in, a
            profile row is created automatically at their selected role.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <InviteUserForm />
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
            <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-agsi-lightGray text-left text-xs uppercase tracking-wider text-agsi-darkGray">
                  <th className="py-2 font-medium">Name</th>
                  <th className="py-2 font-medium">Email</th>
                  <th className="py-2 font-medium">Role</th>
                  <th className="py-2 font-medium">Status</th>
                  <th className="py-2 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} className="border-b border-agsi-lightGray/50">
                    <td className="py-3 font-medium text-agsi-navy">{u.full_name}</td>
                    <td className="py-3 text-agsi-darkGray">{u.email}</td>
                    <td className="py-3">
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
                    </td>
                    <td className="py-3">
                      {u.is_active ? (
                        <Badge variant="green">Active</Badge>
                      ) : (
                        <Badge variant="red">Deactivated</Badge>
                      )}
                    </td>
                    <td className="py-3 text-right">
                      <UserRoleActions
                        userId={u.id}
                        currentRole={u.role}
                        isActive={u.is_active}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

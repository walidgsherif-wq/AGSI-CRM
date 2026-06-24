import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { requireRole } from '@/lib/auth/require-role';
import { serverComponentCookies } from '@/lib/supabase/cookie-adapter';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ROLE_LABEL, type Role } from '@/types/domain';
import { FEATURES } from '@/lib/auth/features';
import {
  FeatureAccessEditor,
  type FeatureRow,
} from './_components/FeatureAccessEditor';
import { WorkEmailEditor } from './_components/WorkEmailEditor';

export const dynamic = 'force-dynamic';

type ProfileRow = {
  id: string;
  full_name: string;
  email: string;
  role: Role;
  is_active: boolean;
  work_email: string | null;
};

export default async function UserAccessPage({ params }: { params: { id: string } }) {
  await requireRole(['admin']);

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: serverComponentCookies(cookies()) },
  );

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, full_name, email, role, is_active, work_email')
    .eq('id', params.id)
    .maybeSingle<ProfileRow>();

  if (!profile) notFound();

  const { data: overrides } = await supabase
    .from('feature_access')
    .select('feature_key, allowed')
    .eq('user_id', profile.id);

  const overrideMap = new Map<string, boolean>(
    (overrides ?? []).map((r) => [r.feature_key as string, r.allowed as boolean]),
  );

  const rows: FeatureRow[] = FEATURES.map((f) => ({
    key: f.key,
    label: f.label,
    description: f.description,
    defaultAllowed: f.defaultRoles.includes(profile.role),
    override: overrideMap.has(f.key) ? overrideMap.get(f.key)! : null,
  }));

  const isAdmin = profile.role === 'admin';

  return (
    <div className="space-y-6">
      <div>
        <Link href="/admin/users" className="text-xs text-agsi-darkGray hover:underline">
          ← Users
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold text-agsi-navy">{profile.full_name}</h1>
          <Badge variant="blue">{ROLE_LABEL[profile.role]}</Badge>
          {profile.is_active ? (
            <Badge variant="green">Active</Badge>
          ) : (
            <Badge variant="red">Deactivated</Badge>
          )}
        </div>
        <p className="mt-1 text-sm text-agsi-darkGray">{profile.email}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Work email</CardTitle>
          <CardDescription>
            Corporate / Outlook alias for this user. Used by the inbound-email
            matcher alongside their sign-in address to attribute mail
            correctly. Leave blank if they only use {profile.email}.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <WorkEmailEditor
            userId={profile.id}
            currentValue={profile.work_email}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Feature access</CardTitle>
          <CardDescription>
            Each feature defaults to this person&apos;s role. Set{' '}
            <strong>Allow</strong> or <strong>Deny</strong> to override for this
            individual; <strong>Default</strong> reverts to the role baseline.
            Restrictions are enforced in the navigation, on the page itself, and
            at the database. Changes are written to the audit log.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isAdmin ? (
            <p className="rounded-lg bg-agsi-lightGray/40 px-4 py-3 text-sm text-agsi-darkGray">
              Admins always have access to every feature and cannot be
              restricted (this prevents an admin locking themselves out). Change
              their role first if you need to limit them.
            </p>
          ) : (
            <FeatureAccessEditor userId={profile.id} rows={rows} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

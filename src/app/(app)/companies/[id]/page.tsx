import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { serverComponentCookies } from '@/lib/supabase/cookie-adapter';
import { getCurrentUser } from '@/lib/auth/get-user';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { LevelBadge } from '@/components/domain/LevelBadge';
import { CompanyForm, type ProfileOption, type CompanyInitial } from '../_components/CompanyForm';
import { COMPANY_TYPE_LABEL } from '@/lib/zod/company';
import { PROJECT_STAGE_LABEL } from '@/lib/zod/project';

export const dynamic = 'force-dynamic';

type DetailRow = CompanyInitial & {
  id: string;
  current_level: 'L0' | 'L1' | 'L2' | 'L3' | 'L4' | 'L5';
  has_active_projects: boolean;
  source: string;
  created_at: string;
};

type LinkedProjectRow = {
  role: string;
  project: {
    id: string;
    name: string;
    stage: keyof typeof PROJECT_STAGE_LABEL;
    city: string | null;
  } | null;
};

export default async function CompanyDetailPage({ params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
    { cookies: serverComponentCookies(cookies()) },
  );

  const { data: company } = await supabase
    .from('companies')
    .select(
      'id, canonical_name, company_type, country, city, phone, email, website, key_contact_name, key_contact_role, key_contact_email, key_contact_phone, notes_internal, is_key_stakeholder, owner_id, current_level, has_active_projects, source, created_at',
    )
    .eq('id', params.id)
    .single<DetailRow>();

  if (!company) notFound();

  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, full_name, role')
    .eq('is_active', true)
    .order('full_name')
    .returns<ProfileOption[]>();

  const { data: linked } = await supabase
    .from('project_companies')
    .select('role, project:projects(id, name, stage, city)')
    .eq('company_id', params.id)
    .eq('is_current', true)
    .returns<LinkedProjectRow[]>();

  const editable =
    user.role === 'admin' ||
    user.role === 'bd_head' ||
    (user.role === 'bd_manager' && company.owner_id === user.id);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <Link href="/companies" className="text-xs text-agsi-darkGray hover:underline">
            ← Companies
          </Link>
          <div className="mt-1 flex items-center gap-3">
            <h1 className="text-2xl font-semibold text-agsi-navy">{company.canonical_name}</h1>
            <LevelBadge level={company.current_level} />
            {company.is_key_stakeholder && <Badge variant="gold">Key</Badge>}
            {company.has_active_projects && <Badge variant="green">Active projects</Badge>}
          </div>
          <p className="mt-1 text-sm text-agsi-darkGray">
            {COMPANY_TYPE_LABEL[company.company_type]} · {company.city ?? 'No city'} · Source: {company.source}
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Details</CardTitle>
          <CardDescription>
            {editable
              ? 'Edit and save. Level changes go through a separate flow (M7).'
              : 'Read-only — you do not own this company and are not a BD Head / Admin.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <CompanyForm
            mode="edit"
            initial={company}
            profiles={profiles ?? []}
            editable={editable}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Linked projects</CardTitle>
          <CardDescription>
            {(linked?.length ?? 0)} current project links. Engagements, tasks, notes, documents, level
            history and ownership timeline land in M6/M7/M9.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {!linked || linked.length === 0 ? (
            <p className="p-6 text-sm text-agsi-darkGray">No linked projects yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-agsi-lightGray text-left text-xs uppercase tracking-wider text-agsi-darkGray">
                  <th className="px-4 py-2 font-medium">Project</th>
                  <th className="px-4 py-2 font-medium">Role</th>
                  <th className="px-4 py-2 font-medium">Stage</th>
                  <th className="px-4 py-2 font-medium">City</th>
                </tr>
              </thead>
              <tbody>
                {linked
                  .filter((l) => l.project)
                  .map((l) => (
                    <tr
                      key={`${l.project!.id}-${l.role}`}
                      className="border-b border-agsi-lightGray/50 hover:bg-agsi-lightGray/20"
                    >
                      <td className="px-4 py-3 font-medium">
                        <Link
                          href={`/projects/${l.project!.id}`}
                          className="text-agsi-navy hover:underline"
                        >
                          {l.project!.name}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-agsi-darkGray capitalize">
                        {l.role.replace(/_/g, ' ')}
                      </td>
                      <td className="px-4 py-3 text-agsi-darkGray">
                        {PROJECT_STAGE_LABEL[l.project!.stage] ?? l.project!.stage}
                      </td>
                      <td className="px-4 py-3 text-agsi-darkGray">{l.project!.city ?? '—'}</td>
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

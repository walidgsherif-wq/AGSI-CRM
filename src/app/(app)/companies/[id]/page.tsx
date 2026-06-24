import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { serverComponentCookies } from '@/lib/supabase/cookie-adapter';
import { getCurrentUser } from '@/lib/auth/get-user';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/table';
import {
  CompanyForm,
  type CompanyInitial,
  type LocationOption,
  type ProfileOption,
} from '../_components/CompanyForm';
import { CompanyClaimButton } from './_components/CompanyClaimButton';
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
    value_aed: number | null;
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
      'id, canonical_name, company_type, country, location_id, city, phone, email, website, key_contact_name, key_contact_role, key_contact_email, key_contact_phone, notes_internal, is_key_stakeholder, owner_id, current_level, has_active_projects, source, created_at',
    )
    .eq('id', params.id)
    .single<DetailRow>();

  if (!company) notFound();

  const [profilesRes, locationsRes] = await Promise.all([
    supabase
      .from('profiles')
      .select('id, full_name, role')
      .eq('is_active', true)
      .order('full_name')
      .returns<ProfileOption[]>(),
    supabase
      .from('city_lookup')
      .select('id, country, emirate, city_name')
      .eq('is_active', true)
      .returns<Array<LocationOption & { city_name: string }>>(),
  ]);
  const profiles = profilesRes.data;
  const locations: LocationOption[] = (locationsRes.data ?? [])
    .filter((l) => l.city_name === l.emirate)
    .map(({ id, country, emirate }) => ({ id, country, emirate }));

  const { data: linked } = await supabase
    .from('project_companies')
    .select('role, project:projects(id, name, stage, city, value_aed)')
    .eq('company_id', params.id)
    .eq('is_current', true)
    .returns<LinkedProjectRow[]>();

  // Per-stakeholder "project value involved": sum the full value of
  // every distinct project this company is linked to. Dedupe by
  // project_id because a company can hold multiple roles on the same
  // project (owner + developer, for instance) and we'd otherwise
  // double-count. Null values count as 0. Intentionally not divided
  // across co-stakeholders — this is a priority signal per company,
  // not a revenue split.
  const seenProjects = new Set<string>();
  let projectValueInvolved = 0;
  for (const l of linked ?? []) {
    if (!l.project) continue;
    if (seenProjects.has(l.project.id)) continue;
    seenProjects.add(l.project.id);
    projectValueInvolved += Number(l.project.value_aed ?? 0);
  }
  const aedFmt = new Intl.NumberFormat('en-AE', {
    style: 'currency',
    currency: 'AED',
    notation: 'compact',
    maximumFractionDigits: 1,
  });

  const editable =
    user.role === 'admin' ||
    user.role === 'bd_head' ||
    (user.role === 'bd_manager' && company.owner_id === user.id);

  const canClaim = company.owner_id === null && user.role !== 'leadership';

  return (
    <div className="space-y-6">
      {canClaim && <CompanyClaimButton companyId={company.id} />}
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
            locations={locations}
            editable={editable}
            userRole={user.role}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Linked projects</CardTitle>
          <CardDescription>
            {(linked?.length ?? 0)} current project links · Project value involved:{' '}
            <span className="font-medium text-agsi-navy">
              {aedFmt.format(projectValueInvolved)}
            </span>
            . Use the Engagements / Tasks / Notes / Documents tabs to log activity
            per company.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {!linked || linked.length === 0 ? (
            <p className="p-6 text-sm text-agsi-darkGray">No linked projects yet.</p>
          ) : (
            <Table>
              <THead>
                <TR head>
                  <TH className="px-4">Project</TH>
                  <TH className="px-4">Role</TH>
                  <TH className="px-4">Stage</TH>
                  <TH className="px-4">City</TH>
                </TR>
              </THead>
              <TBody>
                {linked
                  .filter((l) => l.project)
                  .map((l) => (
                    <TR
                      key={`${l.project!.id}-${l.role}`}
                      className="hover:bg-agsi-lightGray/20"
                    >
                      <TD className="px-4 font-medium">
                        <Link
                          href={`/projects/${l.project!.id}`}
                          className="text-agsi-navy hover:underline"
                        >
                          {l.project!.name}
                        </Link>
                      </TD>
                      <TD className="px-4 text-agsi-darkGray capitalize">
                        {l.role.replace(/_/g, ' ')}
                      </TD>
                      <TD className="px-4 text-agsi-darkGray">
                        {PROJECT_STAGE_LABEL[l.project!.stage] ?? l.project!.stage}
                      </TD>
                      <TD className="px-4 text-agsi-darkGray">{l.project!.city ?? '—'}</TD>
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

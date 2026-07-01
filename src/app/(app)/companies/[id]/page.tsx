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
import { CompanyReleaseButton } from './_components/CompanyReleaseButton';
import { ContactsSection, type ContactRow } from './_components/ContactsSection';
import { PendingLevelUpBadge } from '@/components/domain/PendingLevelUpBadge';
import { RequestGroupButton } from './_components/RequestGroupButton';
import { UngroupChildButton } from './_components/UngroupChildButton';
import { COMPANY_TYPE_LABEL } from '@/lib/zod/company';
import { LevelBadge } from '@/components/domain/LevelBadge';
import { PROJECT_STAGE_LABEL } from '@/lib/zod/project';

export const dynamic = 'force-dynamic';

type DetailRow = CompanyInitial & {
  id: string;
  current_level: 'L0' | 'L1' | 'L2' | 'L3' | 'L4' | 'L5';
  has_active_projects: boolean;
  source: string;
  created_at: string;
  parent_company_id: string | null;
  merged_into_company_id: string | null;
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
      'id, canonical_name, company_type, country, location_id, city, phone, email, website, notes_internal, is_key_stakeholder, owner_id, current_level, has_active_projects, source, created_at, parent_company_id, merged_into_company_id',
    )
    .eq('id', params.id)
    .single<DetailRow>();

  if (!company) notFound();

  // If this company was merged into another, resolve the survivor's
  // name so the banner below can link. The absorbed page still loads
  // (historical URLs shouldn't 404) but it warns loudly and hides
  // most write affordances.
  let mergedIntoRow: { id: string; canonical_name: string } | null = null;
  if (company.merged_into_company_id) {
    const { data } = await supabase
      .from('companies')
      .select('id, canonical_name')
      .eq('id', company.merged_into_company_id)
      .maybeSingle<{ id: string; canonical_name: string }>();
    mergedIntoRow = data ?? null;
  }

  const isHeadOrAdmin = user.role === 'admin' || user.role === 'bd_head';

  // Contacts query: live + (for admin/bd_head) archived. RLS already
  // gates archived visibility, but a leadership/bd_manager session
  // wouldn't get any rows back here anyway — the filter on the second
  // query just avoids a wasted round-trip.
  const [profilesRes, locationsRes, liveContactsRes, archivedContactsRes] =
    await Promise.all([
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
      supabase
        .from('contacts')
        .select(
          'id, company_id, full_name, position, email, phone, is_primary, created_by, created_at, deleted_at, deleted_by',
        )
        .eq('company_id', params.id)
        .is('deleted_at', null)
        .order('is_primary', { ascending: false })
        .order('full_name', { ascending: true })
        .returns<ContactRow[]>(),
      isHeadOrAdmin
        ? supabase
            .from('contacts')
            .select(
              'id, company_id, full_name, position, email, phone, is_primary, created_by, created_at, deleted_at, deleted_by',
            )
            .eq('company_id', params.id)
            .not('deleted_at', 'is', null)
            .order('deleted_at', { ascending: false })
            .returns<ContactRow[]>()
        : Promise.resolve({ data: [] as ContactRow[] }),
    ]);
  const liveContacts = liveContactsRes.data ?? [];
  const archivedContacts = archivedContactsRes.data ?? [];
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

  // Grouping context: parent (if child) + children (if parent) + any
  // pending group request + the picker's company list.
  type GroupMember = {
    id: string;
    canonical_name: string;
    company_type: string;
    current_level: string;
    owner: { full_name: string } | { full_name: string }[] | null;
  };
  const [parentRes, childrenRes, pendingGroupRes, allCompaniesRes] =
    await Promise.all([
      company.parent_company_id
        ? supabase
            .from('companies')
            .select('id, canonical_name')
            .eq('id', company.parent_company_id)
            .maybeSingle<{ id: string; canonical_name: string }>()
        : Promise.resolve({ data: null }),
      supabase
        .from('companies')
        .select(
          'id, canonical_name, company_type, current_level, owner:profiles!companies_owner_id_fkey(full_name)',
        )
        .eq('parent_company_id', company.id)
        .eq('is_active', true)
        .order('canonical_name')
        .returns<GroupMember[]>(),
      supabase
        .from('company_group_requests')
        .select('id, parent_company_id, child_company_ids, status, created_at')
        .or(
          `parent_company_id.eq.${company.id},child_company_ids.cs.{${company.id}}`,
        )
        .eq('status', 'pending')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle<{
          id: string;
          parent_company_id: string;
          child_company_ids: string[];
          status: string;
          created_at: string;
        }>(),
      // Active companies for the request modal's picker. We pull a
      // bounded list (most recent 500) — for a small single-tenant CRM
      // this comfortably covers the picker without paginating.
      supabase
        .from('companies')
        .select('id, canonical_name, parent_company_id')
        .eq('is_active', true)
        .order('canonical_name')
        .limit(500)
        .returns<
          Array<{
            id: string;
            canonical_name: string;
            parent_company_id: string | null;
          }>
        >(),
    ]);
  const parentRow = parentRes.data;
  const groupChildren = childrenRes.data ?? [];
  const pendingGroupRequest = pendingGroupRes.data ?? null;
  const allCompanies = allCompaniesRes.data ?? [];

  const canClaim = company.owner_id === null && user.role !== 'leadership';
  // L2+ progression requires a contactable stakeholder. "Live contact"
  // alone isn't enough — they must have a non-empty email.
  const hasEmailContact = liveContacts.some(
    (c) => c.email !== null && c.email.trim() !== '',
  );
  const needsDetails =
    company.owner_id !== null &&
    (!company.location_id || !hasEmailContact);

  // Most recent pending level_change_request (for the badge).
  const { data: pendingRequest } = await supabase
    .from('level_change_requests')
    .select('id, from_level, to_level')
    .eq('company_id', company.id)
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle<{
      id: string;
      from_level: 'L0' | 'L1' | 'L2' | 'L3' | 'L4' | 'L5';
      to_level: 'L0' | 'L1' | 'L2' | 'L3' | 'L4' | 'L5';
    }>();
  // Release: visible only when the company is currently claimed AND the
  // viewer is the owner OR a bd_head / admin. RPC re-checks the same
  // predicate; UI gate is just to avoid showing a control that would
  // error on click.
  const canRelease =
    company.owner_id !== null &&
    (user.role === 'admin' ||
      user.role === 'bd_head' ||
      company.owner_id === user.id);

  const canRequestGroup =
    user.role !== 'leadership' && !pendingGroupRequest;

  return (
    <div className="space-y-6">
      {company.merged_into_company_id && (
        <div className="rounded-xl border border-rag-red/40 bg-rag-red/10 px-4 py-3 text-sm text-rag-red">
          <strong>Merged</strong> — this record was absorbed into{' '}
          {mergedIntoRow ? (
            <Link
              href={`/companies/${mergedIntoRow.id}` as never}
              className="font-medium underline"
            >
              {mergedIntoRow.canonical_name}
            </Link>
          ) : (
            'another record'
          )}
          . It&rsquo;s hidden from lists but this URL still resolves for audit. New
          activity should be added to the surviving record.
        </div>
      )}
      {parentRow && (
        <p className="text-xs text-agsi-darkGray">
          Part of{' '}
          <Link
            href={`/companies/${parentRow.id}` as never}
            className="font-medium text-agsi-accent hover:underline"
          >
            {parentRow.canonical_name}
          </Link>
        </p>
      )}
      {pendingGroupRequest && (
        <div className="rounded-xl border border-rag-amber/40 bg-rag-amber/10 px-4 py-2 text-xs text-rag-amber">
          Group request pending — an admin will review.
        </div>
      )}
      {canClaim && (
        <CompanyClaimButton companyId={company.id} locations={locations} />
      )}
      {!canClaim && company.owner_id !== null && needsDetails && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-rag-amber/40 bg-rag-amber/10 px-4 py-2">
          <span className="rounded-full bg-rag-amber/20 px-2 py-0.5 text-xs font-semibold text-rag-amber">
            Needs details
          </span>
          <p className="text-xs text-agsi-darkGray">
            Add the stakeholder’s emirate and a contact with a work email
            before moving to L2 or beyond.
          </p>
        </div>
      )}
      {pendingRequest && (
        <div className="flex items-center gap-2">
          <PendingLevelUpBadge
            request={{
              request_id: pendingRequest.id,
              from_level: pendingRequest.from_level,
              to_level: pendingRequest.to_level,
            }}
            viewerRole={user.role}
          />
          <p className="text-xs text-agsi-darkGray">
            A level change has been requested for this stakeholder.
          </p>
        </div>
      )}
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <div>
              <CardTitle>Details</CardTitle>
              <CardDescription>
                {editable
                  ? 'Edit and save. Level changes go through a separate flow (M7).'
                  : 'Read-only — you do not own this company and are not a BD Head / Admin.'}
              </CardDescription>
            </div>
            {canRelease && (
              <CompanyReleaseButton
                companyId={company.id}
                companyName={company.canonical_name}
              />
            )}
          </div>
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
          <CardTitle>Contacts</CardTitle>
          <CardDescription>
            The people you work with at this stakeholder. One contact can be
            flagged Primary. Deletes are soft — recoverable from the archive
            by an admin / BD head.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ContactsSection
            companyId={company.id}
            live={liveContacts}
            archived={archivedContacts}
            currentUserId={user.id}
            userRole={user.role}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle>Group companies</CardTitle>
              <CardDescription>
                Other names listed under this main company, kept safe and
                fully visible. Grouping is associative only — children
                still show in all lists, search, and counts.
              </CardDescription>
            </div>
            {canRequestGroup && (
              <RequestGroupButton
                companyId={company.id}
                companyName={company.canonical_name}
                seed={parentRow ? 'child' : 'parent'}
                options={allCompanies}
                alreadyPending={!!pendingGroupRequest}
              />
            )}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {groupChildren.length === 0 ? (
            <p className="p-6 text-sm text-agsi-darkGray">
              No companies grouped under this one yet.
            </p>
          ) : (
            <Table>
              <THead>
                <TR head>
                  <TH className="px-4">Company</TH>
                  <TH className="px-4">Type</TH>
                  <TH className="px-4">Owner</TH>
                  <TH className="px-4">Level</TH>
                  {user.role === 'admin' && <TH className="px-4"></TH>}
                </TR>
              </THead>
              <TBody>
                {groupChildren.map((c) => {
                  const owner = Array.isArray(c.owner)
                    ? (c.owner[0]?.full_name ?? '—')
                    : (c.owner?.full_name ?? '—');
                  return (
                    <TR key={c.id} className="hover:bg-agsi-lightGray/20">
                      <TD className="px-4 font-medium">
                        <Link
                          href={`/companies/${c.id}` as never}
                          className="text-agsi-navy hover:underline"
                        >
                          {c.canonical_name}
                        </Link>
                      </TD>
                      <TD className="px-4 text-agsi-darkGray">
                        {COMPANY_TYPE_LABEL[
                          c.company_type as keyof typeof COMPANY_TYPE_LABEL
                        ] ?? c.company_type}
                      </TD>
                      <TD className="px-4 text-agsi-darkGray">{owner}</TD>
                      <TD className="px-4">
                        <LevelBadge
                          level={c.current_level as 'L0' | 'L1' | 'L2' | 'L3' | 'L4' | 'L5'}
                        />
                      </TD>
                      {user.role === 'admin' && (
                        <TD className="px-4">
                          <UngroupChildButton
                            childId={c.id}
                            childName={c.canonical_name}
                          />
                        </TD>
                      )}
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          )}
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

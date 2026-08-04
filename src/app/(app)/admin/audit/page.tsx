import Link from 'next/link';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { serverComponentCookies } from '@/lib/supabase/cookie-adapter';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { getCompanyForResolver } from '@/server/actions/companies-search';
import { AuditFilters } from './_components/AuditFilters';
import { AuditEventRow } from './_components/AuditEventRow';

export const dynamic = 'force-dynamic';

// Superset of event_types actually written by any migration site
// (0021, 0028, 0031, 0033, 0045, 0047, 0071, 0073, 0076, 0077, 0081,
// 0082, 0084, 0085, 0086). Kept sorted alphabetically for the filter
// dropdown. When a new writer lands, add its event_type here or the
// dropdown will silently drop it (query is a whitelist).
const ALL_EVENT_TYPES = [
  'app_setting_change',
  'company_claimed',
  'company_group_approved',
  'company_merged',
  'company_unclaimed',
  'contact_archived',
  'contact_created',
  'contact_purged',
  'contact_restored',
  'contact_updated',
  'credit_auto_dedup',
  'ecosystem_point_change',
  'engagement_delete',
  'feature_access_change',
  'level_change',
  'level_change_approval',
  'level_initial_backfill',
  'ownership_transfer',
  'stagnation_rule_change',
] as const;

const ALL_ENTITY_TYPES = [
  'app_setting',
  'company',
  'contact',
  'ecosystem_point_scale',
  'engagement',
  'feature_access',
  'level_change_request',
  'level_history',
  'stagnation_rule',
] as const;

import type { AuditRow } from './_components/types';

const PAGE_SIZE = 50;

export default async function AdminAuditPage({
  searchParams,
}: {
  searchParams: {
    type?: string;
    entity?: string;
    actor?: string;
    company?: string;
    from?: string;
    to?: string;
    page?: string;
  };
}) {
  // Admin layout already enforces requireRole(['admin']).
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
    { cookies: serverComponentCookies(cookies()) },
  );

  const eventTypeFilter =
    searchParams.type && ALL_EVENT_TYPES.includes(searchParams.type as (typeof ALL_EVENT_TYPES)[number])
      ? searchParams.type
      : 'all';
  const entityTypeFilter =
    searchParams.entity &&
    ALL_ENTITY_TYPES.includes(searchParams.entity as (typeof ALL_ENTITY_TYPES)[number])
      ? searchParams.entity
      : 'all';
  const actorFilter = searchParams.actor && searchParams.actor !== 'all' ? searchParams.actor : 'all';
  const companyFilter = searchParams.company ?? '';
  const fromFilter = searchParams.from ?? '';
  const toFilter = searchParams.to ?? '';
  const page = Math.max(1, parseInt(searchParams.page ?? '1', 10) || 1);

  // Build query
  let query = supabase
    .from('audit_events')
    .select(
      'id, actor_id, event_type, entity_type, entity_id, before_json, after_json, occurred_at, actor:profiles!audit_events_actor_id_fkey(full_name)',
      { count: 'exact' },
    )
    .order('occurred_at', { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

  if (eventTypeFilter !== 'all') query = query.eq('event_type', eventTypeFilter);
  if (entityTypeFilter !== 'all') query = query.eq('entity_type', entityTypeFilter);
  if (actorFilter !== 'all') query = query.eq('actor_id', actorFilter);
  // Company filter — scope to events where the company itself is the
  // entity. `entity_type='company'` covers claim/unclaim/transfer/merge/
  // group_approved/level_change/level_initial_backfill — every direct
  // stakeholder-lifecycle event. Engagement / contact / level-request
  // events that only reference the company via before_json aren't
  // included by design (they'd need a JSON filter or a per-child join).
  if (companyFilter) {
    query = query.eq('entity_type', 'company').eq('entity_id', companyFilter);
  }
  if (fromFilter) query = query.gte('occurred_at', fromFilter);
  if (toFilter) query = query.lte('occurred_at', `${toFilter}T23:59:59.999Z`);

  const [eventsRes, actorsRes, initialCompany] = await Promise.all([
    query.returns<AuditRow[]>(),
    supabase
      .from('profiles')
      .select('id, full_name, role')
      .eq('is_active', true)
      .order('full_name')
      .returns<Array<{ id: string; full_name: string; role: string }>>(),
    companyFilter ? getCompanyForResolver(companyFilter) : Promise.resolve(null),
  ]);

  const rows = eventsRes.data ?? [];
  const total = eventsRes.count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const actors = actorsRes.data ?? [];

  // Resolve UUIDs → human names for the entity line on each row.
  // Batches by target table so the whole page costs at most 3 extra
  // round-trips regardless of row count.
  //
  // Keys: `${entity_type}:${entity_id}` → display name. Anything not in
  // the map falls back to the raw UUID in the row component.
  const entityDisplayMap: Record<string, string> = {};
  const companyIds = new Set<string>();
  const profileIds = new Set<string>();
  const contactIds = new Set<string>();
  for (const r of rows) {
    if (!r.entity_id) continue;
    if (r.entity_type === 'company') companyIds.add(r.entity_id);
    else if (r.entity_type === 'feature_access') profileIds.add(r.entity_id);
    else if (r.entity_type === 'contact') contactIds.add(r.entity_id);
  }
  await Promise.all([
    companyIds.size > 0
      ? supabase
          .from('companies')
          .select('id, canonical_name')
          .in('id', Array.from(companyIds))
          .returns<Array<{ id: string; canonical_name: string }>>()
          .then(({ data }) => {
            for (const c of data ?? []) {
              entityDisplayMap[`company:${c.id}`] = c.canonical_name;
            }
          })
      : Promise.resolve(),
    profileIds.size > 0
      ? supabase
          .from('profiles')
          .select('id, full_name')
          .in('id', Array.from(profileIds))
          .returns<Array<{ id: string; full_name: string }>>()
          .then(({ data }) => {
            for (const p of data ?? []) {
              entityDisplayMap[`feature_access:${p.id}`] = p.full_name;
            }
          })
      : Promise.resolve(),
    contactIds.size > 0
      ? supabase
          .from('contacts')
          .select('id, full_name, company_id, company:companies(canonical_name)')
          .in('id', Array.from(contactIds))
          .returns<
            Array<{
              id: string;
              full_name: string | null;
              company_id: string | null;
              company:
                | { canonical_name: string }
                | { canonical_name: string }[]
                | null;
            }>
          >()
          .then(({ data }) => {
            for (const c of data ?? []) {
              const co = Array.isArray(c.company)
                ? (c.company[0] ?? null)
                : c.company;
              const name = c.full_name ?? '(unnamed contact)';
              entityDisplayMap[`contact:${c.id}`] = co
                ? `${name} @ ${co.canonical_name}`
                : name;
            }
          })
      : Promise.resolve(),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-agsi-navy">Audit log</h1>
        <p className="mt-1 text-sm text-agsi-darkGray">
          Every scoring-affecting or destructive action lands here. Admin-only;
          notifications and KPI rollups do not write audit events. {total}{' '}
          {total === 1 ? 'event' : 'events'} match current filters.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Filters</CardTitle>
          <CardDescription>
            All filters are URL-driven so a filtered view is shareable.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AuditFilters
            initialEventType={eventTypeFilter}
            initialEntityType={entityTypeFilter}
            initialActor={actorFilter}
            initialCompany={companyFilter}
            initialCompanyHit={initialCompany}
            initialFrom={fromFilter}
            initialTo={toFilter}
            actors={actors}
            eventTypes={[...ALL_EVENT_TYPES]}
            entityTypes={[...ALL_ENTITY_TYPES]}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle>Events</CardTitle>
              <CardDescription>
                Sorted by most recent. Click a row to see the before / after JSON.
              </CardDescription>
            </div>
            <div className="flex items-center gap-2 text-xs">
              {page > 1 && (
                <PageLink
                  page={page - 1}
                  searchParams={searchParams}
                  label="← Newer"
                />
              )}
              <span className="text-agsi-darkGray">
                Page {page} of {totalPages}
              </span>
              {page < totalPages && (
                <PageLink
                  page={page + 1}
                  searchParams={searchParams}
                  label="Older →"
                />
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {rows.length === 0 ? (
            <div className="px-4 py-6">
              <EmptyState
                title="No audit events match"
                description="Either nothing destructive has happened in this filter window, or your filters are too narrow. Use Clear all in the filter bar to reset."
              />
            </div>
          ) : (
            <ul className="divide-y divide-agsi-lightGray">
              {rows.map((r) => (
                <AuditEventRow
                  key={r.id}
                  row={r}
                  entityDisplayName={
                    r.entity_id
                      ? entityDisplayMap[`${r.entity_type}:${r.entity_id}`]
                      : undefined
                  }
                />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function PageLink({
  page,
  searchParams,
  label,
}: {
  page: number;
  searchParams: Record<string, string | undefined>;
  label: string;
}) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(searchParams)) {
    if (v && k !== 'page') sp.set(k, v);
  }
  sp.set('page', String(page));
  return (
    <Link
      href={`/admin/audit?${sp.toString()}` as never}
      className="rounded-lg bg-agsi-lightGray px-2 py-1 text-agsi-navy hover:bg-agsi-midGray/50"
    >
      {label}
    </Link>
  );
}

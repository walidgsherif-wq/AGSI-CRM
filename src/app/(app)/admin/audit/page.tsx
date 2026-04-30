import Link from 'next/link';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { serverComponentCookies } from '@/lib/supabase/cookie-adapter';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { AuditFilters } from './_components/AuditFilters';
import { AuditEventRow } from './_components/AuditEventRow';

export const dynamic = 'force-dynamic';

const ALL_EVENT_TYPES = [
  'level_change',
  'level_change_approval',
  'ownership_transfer',
  'credit_auto_dedup',
  'engagement_delete',
] as const;

const ALL_ENTITY_TYPES = [
  'company',
  'engagement',
  'level_change_request',
  'level_history',
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
  if (fromFilter) query = query.gte('occurred_at', fromFilter);
  if (toFilter) query = query.lte('occurred_at', `${toFilter}T23:59:59.999Z`);

  const [eventsRes, actorsRes] = await Promise.all([
    query.returns<AuditRow[]>(),
    supabase
      .from('profiles')
      .select('id, full_name, role')
      .eq('is_active', true)
      .order('full_name')
      .returns<Array<{ id: string; full_name: string; role: string }>>(),
  ]);

  const rows = eventsRes.data ?? [];
  const total = eventsRes.count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const actors = actorsRes.data ?? [];

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
                <AuditEventRow key={r.id} row={r} />
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


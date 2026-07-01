import Link from 'next/link';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { serverComponentCookies } from '@/lib/supabase/cookie-adapter';
import { getCurrentUser } from '@/lib/auth/get-user';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { COMPANY_TYPES, COMPANY_TYPE_LABEL } from '@/lib/zod/company';
import { LEVELS, type Level } from '@/types/domain';
import {
  CompaniesTable,
  type CompaniesRow,
  type StatsRow,
  type CompanyAttrs,
} from './_components/CompaniesTable';

export const dynamic = 'force-dynamic';

// FX-024b consumes the company_stats view (FX-024a) for every metric
// number on this page. Companies table is joined only for attributes
// the view doesn't expose (company_type, city, key/active flags, owner
// full_name). All sorting is delegated to Postgres; only the
// company-side filters (type, region, has-MOU) operate at the second
// query — these compose AND.

const BUCKETS = ['hot', 'warm', 'cooling', 'cold'] as const;

// FX-024 sort axes — header clicks on CompaniesTable feed back here
// via ?sort=&dir=. Default: 'steel' desc.
const SORT_OPTIONS = [
  { key: 'steel',   column: 'est_steel_value' },
  { key: 'value',   column: 'project_value_involved' },
  { key: 'count',   column: 'project_count' },
  { key: 'recency', column: 'days_since_last_contact' },
  { key: 'level',   column: 'level' },
] as const;

type SortKey = (typeof SORT_OPTIONS)[number]['key'];

function parseSort(s: string | undefined): SortKey {
  if (!s) return 'steel';
  return (SORT_OPTIONS.find((o) => o.key === s)?.key ?? 'steel') as SortKey;
}

export default async function CompaniesPage({
  searchParams,
}: {
  searchParams: {
    type?: string;
    level?: string;
    q?: string;
    owner?: string;
    bucket?: string;
    region?: string;
    mou?: string;
    sort?: string;
    dir?: string;
    live?: string;
  };
}) {
  const user = await getCurrentUser();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
    { cookies: serverComponentCookies(cookies()) },
  );

  const sortKey = parseSort(searchParams.sort);
  const sortColumn = SORT_OPTIONS.find((o) => o.key === sortKey)!.column;
  const sortDir: 'asc' | 'desc' = searchParams.dir === 'asc' ? 'asc' : 'desc';

  const typeFilter =
    searchParams.type && (COMPANY_TYPES as readonly string[]).includes(searchParams.type)
      ? (searchParams.type as (typeof COMPANY_TYPES)[number])
      : null;
  const levelFilter =
    searchParams.level && (LEVELS as readonly string[]).includes(searchParams.level)
      ? (searchParams.level as Level)
      : null;
  const ownerFilter = searchParams.owner ?? '';
  const bucketFilter =
    searchParams.bucket && (BUCKETS as readonly string[]).includes(searchParams.bucket)
      ? searchParams.bucket
      : null;
  const regionFilter = (searchParams.region ?? '').trim();
  const mouOnly = searchParams.mou === '1';
  // Per F8 (Apr 2026): "active" defaults to is_active=true only — the
  // companies list shows every active company, not just those with a
  // live project on the most recent BNC upload. The toggle below
  // opts in to the narrower "live projects only" view; default is
  // the broader set.
  const liveOnly = searchParams.live === '1';
  const qFilter = (searchParams.q ?? '').trim();

  // Fetch profiles for the owner dropdown.
  const { data: profilesRaw } = await supabase
    .from('profiles')
    .select('id, full_name')
    .eq('is_active', true)
    .in('role', ['admin', 'bd_head', 'bd_manager'])
    .order('full_name');
  const profiles = (profilesRaw ?? []) as Array<{ id: string; full_name: string }>;

  // STEP 1 — query company_stats, sorted + filtered server-side.
  // Paginated to bypass the per-request row cap (same pattern as
  // FX-008 fix on /pipeline).
  const PAGE = 1000;
  const HARD_CAP = 10_000;
  const stats: StatsRow[] = [];
  for (let offset = 0; offset < HARD_CAP; offset += PAGE) {
    let q = supabase
      .from('company_stats')
      .select(
        'company_id, canonical_name, level, owner_id, project_count, project_value_involved, est_steel_value, days_since_last_contact, engagement_bucket',
      )
      .order(sortColumn, {
        ascending: sortDir === 'asc',
        // Recency: NULL = never contacted = coldest → top when sorting
        // DESC by days. Other columns: NULLs trailing for asc, leading
        // for desc, matching Postgres defaults.
        nullsFirst: sortKey === 'recency' && sortDir === 'desc',
      })
      .order('canonical_name', { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (levelFilter) q = q.eq('level', levelFilter);
    if (ownerFilter) q = q.eq('owner_id', ownerFilter);
    if (bucketFilter) q = q.eq('engagement_bucket', bucketFilter);
    if (qFilter) q = q.ilike('canonical_name', `%${qFilter}%`);
    if (mouOnly) q = q.in('level', ['L4', 'L5']);
    const { data: batch } = await q.returns<StatsRow[]>();
    const rows = batch ?? [];
    stats.push(...rows);
    if (rows.length < PAGE) break;
  }

  // STEP 2 — enrich with company attrs (type / city / flags / owner).
  // Chunked .in() so the URL stays small (~100 uuids / chunk).
  //
  // We deliberately do NOT embed the parent name via the self-referencing
  // FK (parent:companies!companies_parent_company_id_fkey). That embed
  // fails whenever PostgREST's schema cache hasn't picked up the FK
  // introduced by 0081 — and when the embed fails, the whole SELECT
  // returns null, every chunk's data is empty, and the page renders
  // "0 of N". Resolving parent names in a separate batch query (same
  // pattern used by /companies/[id]) sidesteps the schema-cache
  // dependency entirely.
  type RawAttrs = Omit<CompanyAttrs, 'parent'>;
  const ids = stats.map((s) => s.company_id);
  const CHUNK = 100;
  const idChunks: string[][] = [];
  for (let i = 0; i < ids.length; i += CHUNK) idChunks.push(ids.slice(i, i + CHUNK));
  const attrResults = await Promise.all(
    idChunks.map((chunk) => {
      let q = supabase
        .from('companies')
        .select(
          'id, company_type, city, is_key_stakeholder, has_active_projects, parent_company_id, owner:profiles!companies_owner_id_fkey(full_name)',
        )
        .eq('is_active', true)
        .is('merged_into_company_id', null)
        .in('id', chunk);
      if (typeFilter) q = q.eq('company_type', typeFilter);
      if (regionFilter) q = q.ilike('city', `%${regionFilter}%`);
      if (liveOnly) q = q.eq('has_active_projects', true);
      return q.returns<RawAttrs[]>();
    }),
  );
  const rawAttrs = attrResults.flatMap((r) => r.data ?? []);

  // Batch-fetch parent canonical names so we can render "part of …".
  const parentIds = Array.from(
    new Set(
      rawAttrs
        .map((a) => a.parent_company_id)
        .filter((id): id is string => !!id),
    ),
  );
  let parentNames = new Map<string, string>();
  if (parentIds.length > 0) {
    const { data: parents } = await supabase
      .from('companies')
      .select('id, canonical_name')
      .in('id', parentIds)
      .returns<Array<{ id: string; canonical_name: string }>>();
    parentNames = new Map((parents ?? []).map((p) => [p.id, p.canonical_name]));
  }

  const attrsMap = new Map<string, CompanyAttrs>();
  for (const a of rawAttrs) {
    const parentName = a.parent_company_id
      ? parentNames.get(a.parent_company_id)
      : null;
    attrsMap.set(a.id, {
      ...a,
      // Only attach parent if we resolved a name — suppresses the
      // "part of …" link when the parent isn't readable.
      parent: parentName ? { canonical_name: parentName } : null,
    });
  }

  // Preserve the sort order from STEP 1 — .in() doesn't, so iterate
  // stats and drop rows whose company didn't survive STEP 2 filters.
  const rows = stats
    .map((s) => ({ stats: s, attrs: attrsMap.get(s.company_id) }))
    .filter((r): r is { stats: StatsRow; attrs: CompanyAttrs } => r.attrs !== undefined);

  const canCreate = user.role !== 'leadership';

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-agsi-navy">Companies</h1>
          <p className="mt-1 text-sm text-agsi-darkGray">
            Canonical stakeholder master. Showing {rows.length} of {stats.length} matching
            company_stats. {liveOnly ? 'Filtered to companies with at least one project on the most recent BNC upload.' : 'All active companies — tick "Only with live projects" to narrow.'} Sort and filter at top.
          </p>
        </div>
        {canCreate && (
          <Link href="/companies/new">
            <Button>New company</Button>
          </Link>
        )}
      </div>

      <Card>
        <CardContent>
          <form className="grid gap-3 sm:grid-cols-4">
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-agsi-darkGray">Search name</label>
              <Input
                name="q"
                defaultValue={qFilter}
                placeholder="Company name…"
                className="mt-1"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-agsi-darkGray">Type</label>
              <Select name="type" defaultValue={typeFilter ?? ''} className="mt-1">
                <option value="">All</option>
                {COMPANY_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {COMPANY_TYPE_LABEL[t]}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <label className="block text-xs font-medium text-agsi-darkGray">Level</label>
              <Select name="level" defaultValue={levelFilter ?? ''} className="mt-1">
                <option value="">All</option>
                {LEVELS.map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <label className="block text-xs font-medium text-agsi-darkGray">Owner</label>
              <Select name="owner" defaultValue={ownerFilter} className="mt-1">
                <option value="">All</option>
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.full_name}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <label className="block text-xs font-medium text-agsi-darkGray">
                Engagement
              </label>
              <Select name="bucket" defaultValue={bucketFilter ?? ''} className="mt-1">
                <option value="">All</option>
                {BUCKETS.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <label className="block text-xs font-medium text-agsi-darkGray">
                Region / city
              </label>
              <Input
                name="region"
                defaultValue={regionFilter}
                placeholder="Dubai, Abu Dhabi…"
                className="mt-1"
              />
            </div>
            <div className="flex items-end">
              <label className="flex items-center gap-2 text-sm text-agsi-navy">
                <input
                  type="checkbox"
                  name="mou"
                  value="1"
                  defaultChecked={mouOnly}
                  className="h-4 w-4 rounded border-agsi-midGray"
                />
                Has MOU (L4+)
              </label>
            </div>
            <div className="flex items-end">
              <label
                className="flex items-center gap-2 text-sm text-agsi-navy"
                title="Off by default — defaults to all active companies. Tick to narrow to those with a project on the most recent BNC upload."
              >
                <input
                  type="checkbox"
                  name="live"
                  value="1"
                  defaultChecked={liveOnly}
                  className="h-4 w-4 rounded border-agsi-midGray"
                />
                Only with live projects
              </label>
            </div>
            {/* Sort is driven by the DataTable header below — see
                CompaniesTable. We still emit the URL `?sort=&dir=`
                params for shareable FX-024c deep-links; hidden inputs
                here carry them through filter-form submits. */}
            <input type="hidden" name="sort" value={sortKey} />
            <input type="hidden" name="dir" value={sortDir} />
            <div className="flex items-end sm:col-span-2">
              <Button type="submit" variant="secondary" className="w-full sm:w-auto">
                Search
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <CompaniesTable
            rows={rows}
            sortKey={sortKey}
            sortDir={sortDir}
            query={{
              q: qFilter || undefined,
              type: typeFilter ?? undefined,
              level: levelFilter ?? undefined,
              owner: ownerFilter || undefined,
              bucket: bucketFilter ?? undefined,
              region: regionFilter || undefined,
              mou: mouOnly ? '1' : undefined,
              live: liveOnly ? '1' : undefined,
            }}
          />
        </CardContent>
      </Card>
    </div>
  );
}

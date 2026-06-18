import Link from 'next/link';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { serverComponentCookies } from '@/lib/supabase/cookie-adapter';
import { getCurrentUser } from '@/lib/auth/get-user';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Avatar } from '@/components/ui/avatar';
import { LevelBadge } from '@/components/domain/LevelBadge';
import { COMPANY_TYPES, COMPANY_TYPE_LABEL } from '@/lib/zod/company';
import { LEVELS, type Level } from '@/types/domain';

export const dynamic = 'force-dynamic';

// FX-024b consumes the company_stats view (FX-024a) for every metric
// number on this page. Companies table is joined only for attributes
// the view doesn't expose (company_type, city, key/active flags, owner
// full_name). All sorting is delegated to Postgres; only the
// company-side filters (type, region, has-MOU) operate at the second
// query — these compose AND.

type StatsRow = {
  company_id: string;
  canonical_name: string;
  level: Level;
  owner_id: string | null;
  project_count: number;
  project_value_involved: number;
  est_steel_value: number;
  days_since_last_contact: number | null;
  engagement_bucket: 'hot' | 'warm' | 'cooling' | 'cold' | null;
};

type CompanyAttrs = {
  id: string;
  company_type: (typeof COMPANY_TYPES)[number];
  city: string | null;
  is_key_stakeholder: boolean;
  has_active_projects: boolean;
  owner: { full_name: string } | null;
};

const BUCKETS = ['hot', 'warm', 'cooling', 'cold'] as const;

const SORT_OPTIONS = [
  { key: 'steel',   label: 'Estimated steel value', column: 'est_steel_value' },
  { key: 'value',   label: 'Project value involved', column: 'project_value_involved' },
  { key: 'count',   label: '# projects',             column: 'project_count' },
  { key: 'recency', label: 'Days since last contact (coldest first)', column: 'days_since_last_contact' },
  { key: 'level',   label: 'Level',                  column: 'level' },
] as const;

type SortKey = (typeof SORT_OPTIONS)[number]['key'];

function parseSort(s: string | undefined): SortKey {
  if (!s) return 'steel';
  return (SORT_OPTIONS.find((o) => o.key === s)?.key ?? 'steel') as SortKey;
}

const aedFmt = new Intl.NumberFormat('en-AE', {
  style: 'currency',
  currency: 'AED',
  notation: 'compact',
  maximumFractionDigits: 1,
});

const BUCKET_BADGE: Record<NonNullable<StatsRow['engagement_bucket']>, 'green' | 'blue' | 'amber' | 'red'> = {
  hot: 'green',
  warm: 'blue',
  cooling: 'amber',
  cold: 'red',
};

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
    show_all?: string;
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
  // Currently-active-only default — list defaults to companies whose
  // has_active_projects is true (the FX-015b sweep makes this truthful
  // at file granularity). Tick the "Show all" box to include
  // historicals. Unchecked submit produces no `show_all` param, which
  // is the same as the default load — so the toggle stays consistent
  // across direct URL, refresh, and form submission.
  const showAll = searchParams.show_all === '1';
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
  const ids = stats.map((s) => s.company_id);
  const CHUNK = 100;
  const idChunks: string[][] = [];
  for (let i = 0; i < ids.length; i += CHUNK) idChunks.push(ids.slice(i, i + CHUNK));
  const attrResults = await Promise.all(
    idChunks.map((chunk) => {
      let q = supabase
        .from('companies')
        .select(
          'id, company_type, city, is_key_stakeholder, has_active_projects, owner:profiles!companies_owner_id_fkey(full_name)',
        )
        .eq('is_active', true)
        .in('id', chunk);
      if (typeFilter) q = q.eq('company_type', typeFilter);
      if (regionFilter) q = q.ilike('city', `%${regionFilter}%`);
      if (!showAll) q = q.eq('has_active_projects', true);
      return q.returns<CompanyAttrs[]>();
    }),
  );
  const attrsMap = new Map<string, CompanyAttrs>();
  for (const r of attrResults) for (const a of r.data ?? []) attrsMap.set(a.id, a);

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
            company_stats. {showAll ? 'Showing all (incl. companies with no current projects).' : 'Currently-active companies only — tick "Show all" to include historicals.'} Sort and filter at top.
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
                title="Off by default — only companies with at least one project in the most recent BNC upload are shown."
              >
                <input
                  type="checkbox"
                  name="show_all"
                  value="1"
                  defaultChecked={showAll}
                  className="h-4 w-4 rounded border-agsi-midGray"
                />
                Show all (incl. no current projects)
              </label>
            </div>
            <div>
              <label className="block text-xs font-medium text-agsi-darkGray">Sort by</label>
              <Select name="sort" defaultValue={sortKey} className="mt-1">
                {SORT_OPTIONS.map((o) => (
                  <option key={o.key} value={o.key}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <label className="block text-xs font-medium text-agsi-darkGray">Direction</label>
              <Select
                name="dir"
                defaultValue={sortDir}
                className="mt-1"
              >
                <option value="desc">Desc (biggest / coldest first)</option>
                <option value="asc">Asc</option>
              </Select>
            </div>
            <div className="flex items-end">
              <Button type="submit" variant="secondary" className="w-full">
                Apply
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {rows.length === 0 ? (
            <p className="p-6 text-sm text-agsi-darkGray">
              No companies match these filters.{' '}
              {canCreate && (
                <Link href="/companies/new" className="text-agsi-accent hover:underline">
                  Create the first one.
                </Link>
              )}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1000px] text-sm">
                <thead>
                  <tr className="border-b border-agsi-lightGray text-left text-xs uppercase tracking-wider text-agsi-darkGray">
                    <th className="px-4 py-2 font-medium">Company</th>
                    <th className="px-4 py-2 font-medium">Type</th>
                    <th className="px-4 py-2 font-medium">Level</th>
                    <th className="px-4 py-2 font-medium">Owner</th>
                    <th className="px-4 py-2 text-right font-medium"># projects</th>
                    <th className="px-4 py-2 text-right font-medium">
                      Project value involved
                    </th>
                    <th className="px-4 py-2 text-right font-medium">Est. steel value</th>
                    <th className="px-4 py-2 font-medium">Engagement</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ stats: s, attrs }) => (
                    <tr
                      key={s.company_id}
                      className="border-b border-agsi-lightGray/50 hover:bg-agsi-lightGray/20"
                    >
                      <td className="px-4 py-3">
                        <Link
                          href={`/companies/${s.company_id}`}
                          className="font-medium text-agsi-navy hover:underline"
                        >
                          {s.canonical_name}
                        </Link>
                        <div className="mt-1 flex flex-wrap gap-1">
                          {attrs.is_key_stakeholder && <Badge variant="gold">Key</Badge>}
                          {attrs.has_active_projects && (
                            <Badge variant="green">Active projects</Badge>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-agsi-darkGray">
                        {COMPANY_TYPE_LABEL[attrs.company_type]}
                      </td>
                      <td className="px-4 py-3">
                        <LevelBadge level={s.level} />
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <Avatar
                            name={attrs.owner?.full_name ?? null}
                            size="xs"
                            title={`Owner: ${attrs.owner?.full_name ?? 'Unassigned'}`}
                          />
                          <span className="text-agsi-darkGray">
                            {attrs.owner?.full_name ?? (
                              <span className="italic">Unassigned</span>
                            )}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-agsi-navy">
                        {Number(s.project_count).toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-agsi-navy">
                        {aedFmt.format(Number(s.project_value_involved))}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-agsi-navy">
                        {aedFmt.format(Number(s.est_steel_value))}
                      </td>
                      <td className="px-4 py-3">
                        {s.engagement_bucket ? (
                          <div className="flex flex-col gap-0.5">
                            <Badge variant={BUCKET_BADGE[s.engagement_bucket]}>
                              {s.engagement_bucket}
                            </Badge>
                            <span className="text-[11px] text-agsi-darkGray">
                              {s.days_since_last_contact === null
                                ? 'never'
                                : `${s.days_since_last_contact}d since`}
                            </span>
                          </div>
                        ) : (
                          <span className="text-xs italic text-agsi-darkGray">—</span>
                        )}
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

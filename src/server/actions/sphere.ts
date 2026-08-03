'use server';

import { revalidatePath } from 'next/cache';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { serverComponentCookies } from '@/lib/supabase/cookie-adapter';
import { getCurrentUser } from '@/lib/auth/get-user';
import { SPOKE_TYPES } from '@/types/coverage';
import { PAGE_SIZE, type SphereQuery } from '@/lib/zod/sphere';

function supabase() {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
    { cookies: serverComponentCookies(cookies()) },
  );
}

export type SphereBuilderRow = {
  company_id: string;
  canonical_name: string;
  company_type: string;
  city: string | null;
  level: string;
  owner_id: string | null;
  owner_name: string | null;
  project_count: number;
  project_value_involved: number;
  in_sphere: boolean;
  added_by: string | null;
  added_by_role: string | null;
  added_at: string | null;
  /** Non-null when this out-of-sphere company has a pending proposal. */
  pending_proposal_id: string | null;
  /** Non-null when a prior proposal was rejected — surfaces the anti-nag hint. */
  rejected_proposal_id: string | null;
};

export type SphereOwnerOption = { id: string; full_name: string };

export type SphereBuilderResponse = {
  rows: SphereBuilderRow[];
  total: number;
  page: number;
  pageSize: number;
  sphereCount: number;
  owners: SphereOwnerOption[];
  cities: string[];
};

const SORT_COLUMN_MAP: Record<SphereQuery['sort'], string> = {
  value_involved: 'project_value_involved',
  project_count: 'project_count',
  name: 'canonical_name',
};

/**
 * Companies + their stats + sphere membership, one page at a time.
 * Restricted to SPOKE_TYPES + active + non-merged so the builder
 * shows the same universe the coverage / segment panels operate on
 * — the sphere targets those same 7 stakeholder categories.
 *
 * Sort runs against company_stats then joins companies for the
 * type/city columns that stats doesn't expose. Two round trips
 * (rows + count) so the paginator can render "X of Y" honestly.
 */
export async function getSphereBuilderRows(
  q: SphereQuery,
): Promise<SphereBuilderResponse> {
  await getCurrentUser();
  const sb = supabase();

  // We paginate over `companies` (has type/city we filter on) and
  // then enrich with `company_stats` (has the sort keys). Filtering
  // on the stats keys themselves is out of scope for the MVP — the
  // sort surface is enough for the "target list building" workflow.
  const from = (q.page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  // Base companies query: SPOKE_TYPES only, active, non-merged.
  let companiesQuery = sb
    .from('companies')
    .select(
      'id, canonical_name, company_type, city, current_level, owner_id, owner:profiles!companies_owner_id_fkey(full_name)',
      { count: 'exact' },
    )
    .eq('is_active', true)
    .is('merged_into_company_id', null)
    .in('company_type', SPOKE_TYPES as unknown as string[]);

  if (q.type) companiesQuery = companiesQuery.eq('company_type', q.type);
  if (q.city) companiesQuery = companiesQuery.eq('city', q.city);
  if (q.owner) companiesQuery = companiesQuery.eq('owner_id', q.owner);
  if (q.q) companiesQuery = companiesQuery.ilike('canonical_name', `%${q.q}%`);

  // If the caller narrows by in/out of sphere, we resolve that up-
  // front against sphere_members and constrain the id list. Small
  // enough (~250 members) to fit in one filter without paging.
  let sphereIds: Set<string> | null = null;
  if (q.in !== 'all') {
    const { data: mem } = await sb
      .from('sphere_members')
      .select('company_id')
      .returns<Array<{ company_id: string }>>();
    sphereIds = new Set((mem ?? []).map((r) => r.company_id));
    if (q.in === 'in') {
      if (sphereIds.size === 0) {
        // No members yet — short-circuit rather than send a
        // gigantic empty IN clause.
        return {
          rows: [],
          total: 0,
          page: q.page,
          pageSize: PAGE_SIZE,
          sphereCount: 0,
          owners: await loadOwnerOptions(sb),
          cities: await loadCityOptions(sb),
        };
      }
      companiesQuery = companiesQuery.in('id', Array.from(sphereIds));
    } else {
      // 'out' — exclude any current members.
      if (sphereIds.size > 0) {
        companiesQuery = companiesQuery.not(
          'id',
          'in',
          `(${Array.from(sphereIds).join(',')})`,
        );
      }
    }
  }

  // Sort. For 'name' we can push down to the companies query
  // directly. For value/count we sort in-memory over the page because
  // company_stats doesn't accept an ORDER at the client SDK level in
  // the same expression tree — the trade-off is small: the page size
  // caps at 50, and total-order rankings live on the pre-fetch cap
  // rather than the SDK.
  if (q.sort === 'name') {
    companiesQuery = companiesQuery.order('canonical_name', {
      ascending: q.dir === 'asc',
    });
  } else {
    // For value / count we need the full filtered set to order
    // globally, then window in-memory. Fetch a wider slice than
    // the page and rank; upstream `total` still reflects the true
    // count so the paginator stays honest. We cap at 5000 to bound
    // memory — well above any realistic BD-team target universe.
    companiesQuery = companiesQuery
      .order('canonical_name', { ascending: true })
      .range(0, Math.min(from + PAGE_SIZE * 50, 4999));
  }

  if (q.sort === 'name') {
    companiesQuery = companiesQuery.range(from, to);
  }

  type CompanyRow = {
    id: string;
    canonical_name: string;
    company_type: string;
    city: string | null;
    current_level: string;
    owner_id: string | null;
    owner: { full_name: string } | { full_name: string }[] | null;
  };
  const { data: cRows, count } = await companiesQuery.returns<CompanyRow[]>();
  const companies = cRows ?? [];

  // Fetch stats for the fetched IDs — one query.
  const ids = companies.map((c) => c.id);
  type StatsRow = {
    company_id: string;
    project_count: number | string;
    project_value_involved: number | string;
  };
  let statsById = new Map<string, { count: number; value: number }>();
  if (ids.length > 0) {
    const { data: stats } = await sb
      .from('company_stats')
      .select('company_id, project_count, project_value_involved')
      .in('company_id', ids)
      .returns<StatsRow[]>();
    for (const s of stats ?? []) {
      statsById.set(s.company_id, {
        count: Number(s.project_count ?? 0),
        value: Number(s.project_value_involved ?? 0),
      });
    }
  }

  // Membership rows for the same IDs — one query.
  type MemRow = {
    company_id: string;
    added_by: string | null;
    added_by_role: string;
    added_at: string;
  };
  const memByCompany = new Map<string, MemRow>();
  if (ids.length > 0) {
    const { data: mems } = await sb
      .from('sphere_members')
      .select('company_id, added_by, added_by_role, added_at')
      .in('company_id', ids)
      .returns<MemRow[]>();
    for (const m of mems ?? []) memByCompany.set(m.company_id, m);
  }

  // Pending / rejected proposals for the same IDs — one query, both
  // status buckets, split client-side. bd_manager RLS only lets them
  // see their own proposals; admin/bd_head see all. The UI treats a
  // manager who doesn't see a peer's pending proposal as "not
  // proposed" for their view — the propose action will then dedup
  // server-side via the RPC.
  type PropRow = {
    id: string;
    company_id: string;
    status: 'pending' | 'rejected' | 'approved';
  };
  const pendingByCompany = new Map<string, string>();
  const rejectedByCompany = new Map<string, string>();
  if (ids.length > 0) {
    const { data: props } = await sb
      .from('sphere_proposals')
      .select('id, company_id, status')
      .in('company_id', ids)
      .in('status', ['pending', 'rejected'])
      .returns<PropRow[]>();
    for (const p of props ?? []) {
      if (p.status === 'pending' && !pendingByCompany.has(p.company_id)) {
        pendingByCompany.set(p.company_id, p.id);
      } else if (p.status === 'rejected' && !rejectedByCompany.has(p.company_id)) {
        rejectedByCompany.set(p.company_id, p.id);
      }
    }
  }

  // Merge into typed rows.
  let rows: SphereBuilderRow[] = companies.map((c) => {
    const s = statsById.get(c.id) ?? { count: 0, value: 0 };
    const m = memByCompany.get(c.id) ?? null;
    const owner = Array.isArray(c.owner) ? c.owner[0] : c.owner;
    return {
      company_id: c.id,
      canonical_name: c.canonical_name,
      company_type: c.company_type,
      city: c.city,
      level: c.current_level,
      owner_id: c.owner_id,
      owner_name: owner?.full_name ?? null,
      project_count: s.count,
      project_value_involved: s.value,
      in_sphere: !!m,
      added_by: m?.added_by ?? null,
      added_by_role: m?.added_by_role ?? null,
      added_at: m?.added_at ?? null,
      pending_proposal_id: pendingByCompany.get(c.id) ?? null,
      rejected_proposal_id: rejectedByCompany.get(c.id) ?? null,
    };
  });

  // In-memory sort for value / count over the fetched slice, then window.
  if (q.sort !== 'name') {
    const col: keyof SphereBuilderRow =
      q.sort === 'value_involved' ? 'project_value_involved' : 'project_count';
    rows.sort((a, b) => {
      const av = Number(a[col] ?? 0);
      const bv = Number(b[col] ?? 0);
      if (av === bv) return a.canonical_name.localeCompare(b.canonical_name);
      return q.dir === 'asc' ? av - bv : bv - av;
    });
    rows = rows.slice(from, to + 1);
  }

  const [{ count: sphereCount }, owners, cities] = await Promise.all([
    sb
      .from('sphere_members')
      .select('company_id', { count: 'exact', head: true }),
    loadOwnerOptions(sb),
    loadCityOptions(sb),
  ]);

  return {
    rows,
    total: count ?? 0,
    page: q.page,
    pageSize: PAGE_SIZE,
    sphereCount: sphereCount ?? 0,
    owners,
    cities,
  };
}

async function loadOwnerOptions(
  sb: ReturnType<typeof supabase>,
): Promise<SphereOwnerOption[]> {
  const { data } = await sb
    .from('profiles')
    .select('id, full_name')
    .eq('is_active', true)
    .in('role', ['admin', 'bd_head', 'bd_manager'])
    .order('full_name', { ascending: true })
    .returns<SphereOwnerOption[]>();
  return data ?? [];
}

async function loadCityOptions(
  sb: ReturnType<typeof supabase>,
): Promise<string[]> {
  const { data } = await sb
    .from('companies')
    .select('city')
    .eq('is_active', true)
    .is('merged_into_company_id', null)
    .not('city', 'is', null)
    .in('company_type', SPOKE_TYPES as unknown as string[])
    .returns<Array<{ city: string | null }>>();
  const uniq = new Set<string>();
  for (const r of data ?? []) if (r.city) uniq.add(r.city);
  return Array.from(uniq).sort((a, b) => a.localeCompare(b));
}

/**
 * Add a batch of companies directly to the sphere. Governance
 * (amended 0098): admin / bd_head only. Managers propose via
 * proposeForSphere() and admin/bd_head decide from the inbox.
 *   - added_by is stamped auth.uid() (RLS pins this).
 *   - added_by_role is stamped from the caller's current profile role.
 *   - Ignores companies already in the sphere (ON CONFLICT DO NOTHING).
 */
export async function addToSphere(
  companyIds: string[],
  note?: string | null,
): Promise<{ added: number } | { error: string }> {
  const user = await getCurrentUser();
  if (!['admin', 'bd_head'].includes(user.role)) {
    return {
      error:
        'Managers propose stakeholders for the sphere; only admin or bd_head add directly.',
    };
  }
  const ids = Array.from(new Set(companyIds.filter(Boolean))).slice(0, 500);
  if (ids.length === 0) return { added: 0 };

  const sb = supabase();
  // Fetch existing member ids so we can report a truthful "added"
  // count (the client can then decide whether to toast "N added,
  // K already in").
  const { data: existing } = await sb
    .from('sphere_members')
    .select('company_id')
    .in('company_id', ids)
    .returns<Array<{ company_id: string }>>();
  const already = new Set((existing ?? []).map((r) => r.company_id));

  const toInsert = ids.filter((id) => !already.has(id));
  if (toInsert.length === 0) return { added: 0 };

  const rows = toInsert.map((company_id) => ({
    company_id,
    added_by: user.id,
    added_by_role: user.role,
    note: note ?? null,
  }));

  const { error } = await sb.from('sphere_members').insert(rows);
  if (error) return { error: error.message };

  revalidatePath('/sphere');
  return { added: rows.length };
}

/**
 * Remove a batch. Governance enforced BOTH server-side (checked here
 * so we can return a legible message) AND at RLS (defence in depth —
 * a bd_manager trying to remove an admin-added row via a hand-crafted
 * PostgREST call is dropped by the delete_manager_own policy).
 */
/**
 * Remove sphere entries. Amended governance (0098): admin / bd_head
 * only. Managers cannot remove any row — including ones they had
 * originally proposed — since even those are, after approval, admin/
 * head-owned membership decisions.
 */
export async function removeFromSphere(
  companyIds: string[],
): Promise<
  { removed: number } | { error: string }
> {
  const user = await getCurrentUser();
  if (!['admin', 'bd_head'].includes(user.role)) {
    return {
      error:
        'Only admin or bd_head can remove from the sphere.',
    };
  }
  const ids = Array.from(new Set(companyIds.filter(Boolean))).slice(0, 500);
  if (ids.length === 0) return { removed: 0 };

  const { error } = await supabase()
    .from('sphere_members')
    .delete()
    .in('company_id', ids);
  if (error) return { error: error.message };

  revalidatePath('/sphere');
  return { removed: ids.length };
}

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
 * Rows for the sphere builder. **Driven from `company_stats`** (0052,
 * widened in 0099) so ORDER BY value / count runs at the DB against
 * the entire filtered universe — not a name-first pre-fetch cap
 * sorted in memory. That was the pre-0099 bug: page 1 of "top value"
 * only reflected the alphabetical head of the ~3.6k universe.
 *
 * Every filter — type / city / owner / search / min-value / min-count
 * / in-out-of-sphere — pushes down as a WHERE on the view. Range +
 * sort + count all cooperate: page N is the true window of the
 * ordered filtered set, and `total` is the exact match count.
 *
 * Small enrichments (owner full_name, membership, proposal state)
 * come from parallel lookups on the returned page ids — bounded and
 * cheap.
 */
export async function getSphereBuilderRows(
  q: SphereQuery,
): Promise<SphereBuilderResponse> {
  await getCurrentUser();
  const sb = supabase();
  const from = (q.page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  // ── 1) Build the view-driven base query with every filter ──────
  let viewQuery = sb
    .from('company_stats')
    .select(
      'company_id, canonical_name, company_type, city, level, owner_id, project_count, project_value_involved',
      { count: 'exact' },
    )
    .eq('is_active', true)
    .is('merged_into_company_id', null)
    .in('company_type', SPOKE_TYPES as unknown as string[]);

  if (q.type) viewQuery = viewQuery.eq('company_type', q.type);
  if (q.city) viewQuery = viewQuery.eq('city', q.city);
  if (q.owner) viewQuery = viewQuery.eq('owner_id', q.owner);
  if (q.q) viewQuery = viewQuery.ilike('canonical_name', `%${q.q}%`);
  if (q.min_value !== undefined) {
    viewQuery = viewQuery.gte('project_value_involved', q.min_value);
  }
  if (q.min_count !== undefined) {
    viewQuery = viewQuery.gte('project_count', q.min_count);
  }

  // Membership scope — one lookup, `.in()` for "in sphere", `.not
  // .in()` for "out". `sphere_members` peaks around a few hundred
  // rows so the URL length is bounded.
  if (q.in !== 'all') {
    const { data: mem } = await sb
      .from('sphere_members')
      .select('company_id')
      .returns<Array<{ company_id: string }>>();
    const sphereIds = (mem ?? []).map((r) => r.company_id);
    if (q.in === 'in') {
      if (sphereIds.length === 0) {
        return emptyResponse(sb, q.page);
      }
      viewQuery = viewQuery.in('company_id', sphereIds);
    } else if (sphereIds.length > 0) {
      viewQuery = viewQuery.not(
        'company_id',
        'in',
        `(${sphereIds.join(',')})`,
      );
    }
  }

  // ── 2) Order + range at the DB ─────────────────────────────────
  const primarySort = SORT_COLUMN_MAP[q.sort];
  viewQuery = viewQuery.order(primarySort, {
    ascending: q.dir === 'asc',
    nullsFirst: false,
  });
  // Deterministic tiebreaker so ties don't shuffle across page loads.
  if (q.sort !== 'name') {
    viewQuery = viewQuery.order('canonical_name', { ascending: true });
  }
  viewQuery = viewQuery.range(from, to);

  type ViewRow = {
    company_id: string;
    canonical_name: string;
    company_type: string;
    city: string | null;
    level: string;
    owner_id: string | null;
    project_count: number | string;
    project_value_involved: number | string;
  };
  const { data: vRows, count } = await viewQuery.returns<ViewRow[]>();
  const pageRows = vRows ?? [];
  const ids = pageRows.map((r) => r.company_id);

  // ── 3) Small enrichments for the page ─────────────────────────
  // Owner names — one query for the BD-team profile roster (small,
  // ~10 rows; simpler than embedded joins on the view which
  // PostgREST can't infer without FKs).
  const [owners, cities, memPage, proposalPage, sphereCountRes] =
    await Promise.all([
      loadOwnerOptions(sb),
      loadCityOptions(sb),
      ids.length === 0
        ? Promise.resolve({ data: [] as MemRow[] })
        : sb
            .from('sphere_members')
            .select('company_id, added_by, added_by_role, added_at')
            .in('company_id', ids)
            .returns<MemRow[]>()
            .then((r) => ({ data: r.data ?? [] })),
      ids.length === 0
        ? Promise.resolve({ data: [] as PropRow[] })
        : sb
            .from('sphere_proposals')
            .select('id, company_id, status')
            .in('company_id', ids)
            .in('status', ['pending', 'rejected'])
            .returns<PropRow[]>()
            .then((r) => ({ data: r.data ?? [] })),
      sb
        .from('sphere_members')
        .select('company_id', { count: 'exact', head: true }),
    ]);

  const ownerNameById = new Map(owners.map((o) => [o.id, o.full_name]));

  const memByCompany = new Map<string, MemRow>();
  for (const m of memPage.data) memByCompany.set(m.company_id, m);

  const pendingByCompany = new Map<string, string>();
  const rejectedByCompany = new Map<string, string>();
  for (const p of proposalPage.data) {
    if (p.status === 'pending' && !pendingByCompany.has(p.company_id)) {
      pendingByCompany.set(p.company_id, p.id);
    } else if (
      p.status === 'rejected' &&
      !rejectedByCompany.has(p.company_id)
    ) {
      rejectedByCompany.set(p.company_id, p.id);
    }
  }

  // ── 4) Assemble typed rows — order preserved from the view ────
  const rows: SphereBuilderRow[] = pageRows.map((r) => {
    const m = memByCompany.get(r.company_id) ?? null;
    return {
      company_id: r.company_id,
      canonical_name: r.canonical_name,
      company_type: r.company_type,
      city: r.city,
      level: r.level,
      owner_id: r.owner_id,
      owner_name: r.owner_id ? (ownerNameById.get(r.owner_id) ?? null) : null,
      project_count: Number(r.project_count ?? 0),
      project_value_involved: Number(r.project_value_involved ?? 0),
      in_sphere: !!m,
      added_by: m?.added_by ?? null,
      added_by_role: m?.added_by_role ?? null,
      added_at: m?.added_at ?? null,
      pending_proposal_id: pendingByCompany.get(r.company_id) ?? null,
      rejected_proposal_id: rejectedByCompany.get(r.company_id) ?? null,
    };
  });

  return {
    rows,
    total: count ?? 0,
    page: q.page,
    pageSize: PAGE_SIZE,
    sphereCount: sphereCountRes.count ?? 0,
    owners,
    cities,
  };
}

type MemRow = {
  company_id: string;
  added_by: string | null;
  added_by_role: string;
  added_at: string;
};

type PropRow = {
  id: string;
  company_id: string;
  status: 'pending' | 'rejected' | 'approved';
};

/**
 * Applies the same WHERE chain as getSphereBuilderRows to a base
 * query on company_stats. Extracted so the count / resolve-ids /
 * row queries all agree on the filter semantics — "N matching" and
 * "add all matching" are guaranteed to see the same universe.
 *
 * The membership scope (`q.in`) is applied here too; if the caller
 * already has the sphere-member id set they can pass it in via
 * `sphereIds` to avoid a second lookup.
 */
async function applySphereFilters(
  sb: ReturnType<typeof supabase>,
  q: SphereQuery,
  opts?: { sphereIds?: string[] },
) {
  let query = sb
    .from('company_stats')
    .select('company_id', { count: 'exact', head: true })
    .eq('is_active', true)
    .is('merged_into_company_id', null)
    .in('company_type', SPOKE_TYPES as unknown as string[]);

  if (q.type) query = query.eq('company_type', q.type);
  if (q.city) query = query.eq('city', q.city);
  if (q.owner) query = query.eq('owner_id', q.owner);
  if (q.q) query = query.ilike('canonical_name', `%${q.q}%`);
  if (q.min_value !== undefined) {
    query = query.gte('project_value_involved', q.min_value);
  }
  if (q.min_count !== undefined) {
    query = query.gte('project_count', q.min_count);
  }

  if (q.in !== 'all') {
    let sphereIds = opts?.sphereIds;
    if (sphereIds === undefined) {
      const { data } = await sb
        .from('sphere_members')
        .select('company_id')
        .returns<Array<{ company_id: string }>>();
      sphereIds = (data ?? []).map((r) => r.company_id);
    }
    if (q.in === 'in') {
      if (sphereIds.length === 0) {
        // Force an impossible predicate so the query returns 0 —
        // simpler than returning a special sentinel.
        query = query.eq('company_id', '00000000-0000-0000-0000-000000000000');
      } else {
        query = query.in('company_id', sphereIds);
      }
    } else if (sphereIds.length > 0) {
      query = query.not('company_id', 'in', `(${sphereIds.join(',')})`);
    }
  }

  return query;
}

/**
 * Count of companies matching the current filter across the entire
 * universe (not paged). Backs the "Select all N matching this filter"
 * affordance in the builder. head+count so no rows come over the wire.
 */
export async function countSphereMatches(q: SphereQuery): Promise<number> {
  await getCurrentUser();
  const query = await applySphereFilters(supabase(), q);
  const { count } = await query;
  return count ?? 0;
}

/**
 * All matching company_ids for the current filter — paged internally
 * so a filter that matches thousands of rows doesn't overwhelm any
 * single response. Returns the raw ordered id list.
 */
async function resolveMatchingCompanyIds(q: SphereQuery): Promise<string[]> {
  const sb = supabase();
  const PAGE = 1000;
  const HARD_CAP = 20_000;
  const ids: string[] = [];
  // Fetch memberships once for the in/out scope so each page uses
  // the same set.
  let sphereIds: string[] | undefined;
  if (q.in !== 'all') {
    const { data } = await sb
      .from('sphere_members')
      .select('company_id')
      .returns<Array<{ company_id: string }>>();
    sphereIds = (data ?? []).map((r) => r.company_id);
    if (q.in === 'in' && sphereIds.length === 0) return [];
  }

  for (let offset = 0; offset < HARD_CAP; offset += PAGE) {
    let query = sb
      .from('company_stats')
      .select('company_id')
      .eq('is_active', true)
      .is('merged_into_company_id', null)
      .in('company_type', SPOKE_TYPES as unknown as string[])
      .order('company_id', { ascending: true })
      .range(offset, offset + PAGE - 1);

    if (q.type) query = query.eq('company_type', q.type);
    if (q.city) query = query.eq('city', q.city);
    if (q.owner) query = query.eq('owner_id', q.owner);
    if (q.q) query = query.ilike('canonical_name', `%${q.q}%`);
    if (q.min_value !== undefined) {
      query = query.gte('project_value_involved', q.min_value);
    }
    if (q.min_count !== undefined) {
      query = query.gte('project_count', q.min_count);
    }
    if (q.in === 'in' && sphereIds) {
      query = query.in('company_id', sphereIds);
    } else if (q.in === 'out' && sphereIds && sphereIds.length > 0) {
      query = query.not('company_id', 'in', `(${sphereIds.join(',')})`);
    }

    const { data } = await query.returns<Array<{ company_id: string }>>();
    const chunk = data ?? [];
    for (const r of chunk) ids.push(r.company_id);
    if (chunk.length < PAGE) break;
  }
  return ids;
}

const BULK_CHUNK = 500;

/**
 * Add every company matching the current filter to the sphere. Full-
 * set add is admin/bd_head only — managers stay on the single-company
 * propose path so bulk work always routes through curation.
 *
 * Server-side by filter, not by client-supplied id list, so a manager
 * can't hand-craft a request to sneak past the governance rules.
 */
export async function addAllMatchingToSphere(
  q: SphereQuery,
): Promise<{ added: number; total: number } | { error: string }> {
  const user = await getCurrentUser();
  if (!['admin', 'bd_head'].includes(user.role)) {
    return {
      error: 'Only admin or bd_head can bulk-add matching companies.',
    };
  }

  const ids = await resolveMatchingCompanyIds(q);
  if (ids.length === 0) return { added: 0, total: 0 };

  const sb = supabase();

  // Dedup against existing members up-front so the "added" count is
  // truthful — the underlying INSERT is idempotent thanks to the PK,
  // but reporting is cleaner this way.
  const { data: existing } = await sb
    .from('sphere_members')
    .select('company_id')
    .in('company_id', ids.slice(0, 10_000))
    .returns<Array<{ company_id: string }>>();
  const already = new Set((existing ?? []).map((r) => r.company_id));
  const toInsert = ids.filter((id) => !already.has(id));

  let added = 0;
  for (let i = 0; i < toInsert.length; i += BULK_CHUNK) {
    const batch = toInsert.slice(i, i + BULK_CHUNK).map((company_id) => ({
      company_id,
      added_by: user.id,
      added_by_role: user.role,
      note: null as string | null,
    }));
    const { error } = await sb.from('sphere_members').insert(batch);
    if (error) return { error: error.message };
    added += batch.length;
  }

  revalidatePath('/sphere');
  return { added, total: ids.length };
}

/**
 * Remove every company matching the current filter from the sphere.
 * Full-set remove is admin/bd_head only (mirror of the add-side rule).
 * Enumerates the matching set server-side, then intersects with
 * current members so we only send a DELETE for rows that actually
 * exist.
 */
export async function removeAllMatchingFromSphere(
  q: SphereQuery,
): Promise<{ removed: number; total: number } | { error: string }> {
  const user = await getCurrentUser();
  if (!['admin', 'bd_head'].includes(user.role)) {
    return {
      error: 'Only admin or bd_head can bulk-remove matching companies.',
    };
  }

  const ids = await resolveMatchingCompanyIds(q);
  if (ids.length === 0) return { removed: 0, total: 0 };

  const sb = supabase();

  // Only actual members can be removed — a filter that includes
  // non-members would otherwise report zero-noise DELETEs.
  const { data: existing } = await sb
    .from('sphere_members')
    .select('company_id')
    .in('company_id', ids.slice(0, 10_000))
    .returns<Array<{ company_id: string }>>();
  const memberIds = (existing ?? []).map((r) => r.company_id);
  if (memberIds.length === 0) return { removed: 0, total: ids.length };

  let removed = 0;
  for (let i = 0; i < memberIds.length; i += BULK_CHUNK) {
    const batch = memberIds.slice(i, i + BULK_CHUNK);
    const { error } = await sb
      .from('sphere_members')
      .delete()
      .in('company_id', batch);
    if (error) return { error: error.message };
    removed += batch.length;
  }

  revalidatePath('/sphere');
  return { removed, total: ids.length };
}

async function emptyResponse(
  sb: ReturnType<typeof supabase>,
  page: number,
): Promise<SphereBuilderResponse> {
  const [owners, cities, sphereCountRes] = await Promise.all([
    loadOwnerOptions(sb),
    loadCityOptions(sb),
    sb.from('sphere_members').select('company_id', { count: 'exact', head: true }),
  ]);
  return {
    rows: [],
    total: 0,
    page,
    pageSize: PAGE_SIZE,
    sphereCount: sphereCountRes.count ?? 0,
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

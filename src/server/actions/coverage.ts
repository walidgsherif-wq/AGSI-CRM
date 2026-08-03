'use server';

import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { serverComponentCookies } from '@/lib/supabase/cookie-adapter';
import { COMPANY_TYPE_LABEL } from '@/lib/zod/company';
import {
  BAND_THRESHOLD,
  SPOKE_TYPES,
  type CoverageResult,
  type CoverageRow,
  type MemberContribution,
  type SpokeType,
  type Universe,
  type ValueBand,
} from '@/types/coverage';
import { resolveSphereScope } from '@/lib/sphere-scope';

function supabase() {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
    { cookies: serverComponentCookies(cookies()) },
  );
}

/**
 * Per-stakeholder-type coverage + per-member contributions.
 *
 *   denominator    = active companies of that type (or, when a value
 *                    band is set, active companies of that type linked
 *                    to a project with value_aed >= the band threshold).
 *   numerator      = same set, additionally constrained to owner_id IS
 *                    NOT NULL — companies the BD team has claimed.
 *   coverage_pct   = numerator / denominator * 100.
 *   by_member[]    = per-owner contribution to the numerator, with
 *                    share_pct = count / denominator * 100 (their
 *                    absolute share of the universe, NOT of the
 *                    claimed slice — so the segments sum up to the
 *                    overall coverage_pct).
 *
 * Aggregation runs server-side under the caller's RLS context.
 * companies / project_companies / projects / profiles all have
 * transparent SELECT for any authenticated user, so the totals are
 * honest team-wide counts regardless of who's viewing.
 *
 * Errors: every DB fetch's error is captured. The first error short-
 * circuits the pipeline and surfaces via `error` on the result so the
 * panel can render a real error state instead of silently rendering
 * "0 of 0" (the exact symptom that hid a filter mismatch for a build).
 */
export async function getCoverageByType(
  band: ValueBand = 'all',
  universe: Universe = 'sphere',
): Promise<CoverageResult> {
  const sb = supabase();
  const threshold = BAND_THRESHOLD[band];
  const scope = await resolveSphereScope(sb, universe);
  const emptyRows: CoverageRow[] = SPOKE_TYPES.map((t) => ({
    type: t,
    label: COMPANY_TYPE_LABEL[t],
    numerator: 0,
    denominator: 0,
    coverage_pct: 0,
    by_member: [],
  }));

  // 1) Paginated fetch of active companies.
  type CompanyMinimal = {
    id: string;
    company_type: SpokeType;
    owner_id: string | null;
  };
  const PAGE = 1000;
  const HARD_CAP = 20_000;
  const companies: CompanyMinimal[] = [];
  for (let offset = 0; offset < HARD_CAP; offset += PAGE) {
    const { data, error } = await sb
      .from('companies')
      .select('id, company_type, owner_id')
      .eq('is_active', true)
      .is('merged_into_company_id', null)
      .in('company_type', SPOKE_TYPES as unknown as string[])
      .order('id', { ascending: true })
      .range(offset, offset + PAGE - 1)
      .returns<CompanyMinimal[]>();
    if (error) {
      console.error('[coverage] companies fetch failed', {
        offset,
        band,
        message: error.message,
        details: error.details,
        hint: error.hint,
        code: error.code,
      });
      return {
        rows: emptyRows,
        error: `companies fetch: ${error.message}`,
        universe: scope.applied,
        sphereEmpty: scope.sphereEmpty,
      };
    }
    const rows = data ?? [];
    companies.push(...rows);
    if (rows.length < PAGE) break;
  }

  // 2) Optional value-band restriction — distinct company_ids linked to
  // a project with value_aed >= threshold. Paginated embedded filter.
  let companyIdsInBand: Set<string> | null = null;
  if (threshold !== null) {
    type PcRow = { company_id: string };
    companyIdsInBand = new Set<string>();
    for (let offset = 0; offset < HARD_CAP; offset += PAGE) {
      const { data, error } = await sb
        .from('project_companies')
        .select('company_id, projects!inner(value_aed)')
        .gte('projects.value_aed', threshold)
        .order('company_id', { ascending: true })
        .range(offset, offset + PAGE - 1)
        .returns<PcRow[]>();
      if (error) {
        console.error('[coverage] project_companies fetch failed', {
          offset,
          band,
          message: error.message,
          details: error.details,
          hint: error.hint,
          code: error.code,
        });
        return {
          rows: emptyRows,
          error: `project_companies fetch: ${error.message}`,
          universe: scope.applied,
          sphereEmpty: scope.sphereEmpty,
        };
      }
      const rows = data ?? [];
      for (const r of rows) companyIdsInBand.add(r.company_id);
      if (rows.length < PAGE) break;
    }
  }

  // 3) Bucket counts. Per type: denominator, numerator, per-owner counts.
  type Bucket = { den: number; num: number; perMember: Map<string, number> };
  const buckets: Record<SpokeType, Bucket> = {
    developer: { den: 0, num: 0, perMember: new Map() },
    design_consultant: { den: 0, num: 0, perMember: new Map() },
    main_contractor: { den: 0, num: 0, perMember: new Map() },
    mep_consultant: { den: 0, num: 0, perMember: new Map() },
    mep_contractor: { den: 0, num: 0, perMember: new Map() },
    authority: { den: 0, num: 0, perMember: new Map() },
    society: { den: 0, num: 0, perMember: new Map() },
  };

  const ownerIds = new Set<string>();
  for (const c of companies) {
    if (companyIdsInBand && !companyIdsInBand.has(c.id)) continue;
    // Sphere scope — intersect the universe with sphere_members.
    // Applied to BOTH numerator and denominator so coverage_pct
    // stays honest. Skipped when scope.memberIds is null (either
    // universe='full' or the sphere was empty and we fell back).
    if (scope.memberIds && !scope.memberIds.has(c.id)) continue;
    const b = buckets[c.company_type];
    if (!b) continue;
    b.den += 1;
    if (c.owner_id) {
      b.num += 1;
      b.perMember.set(c.owner_id, (b.perMember.get(c.owner_id) ?? 0) + 1);
      ownerIds.add(c.owner_id);
    }
  }

  // 4) Resolve owner names. Falls back to a truncated id if a profile
  // can't be loaded (e.g. RLS edge case or deactivated user).
  const memberNames = new Map<string, string>();
  if (ownerIds.size > 0) {
    type ProfileRow = { id: string; full_name: string };
    const { data, error } = await sb
      .from('profiles')
      .select('id, full_name')
      .in('id', Array.from(ownerIds))
      .returns<ProfileRow[]>();
    if (error) {
      console.error('[coverage] profiles fetch failed', {
        message: error.message,
        details: error.details,
        hint: error.hint,
        code: error.code,
      });
      // Non-fatal — fall back to id-prefix labels below.
    }
    for (const p of data ?? []) memberNames.set(p.id, p.full_name);
  }

  const rows = SPOKE_TYPES.map((t) => {
    const b = buckets[t];
    const by_member: MemberContribution[] = Array.from(b.perMember.entries())
      .map(([id, count]) => ({
        member_id: id,
        full_name: memberNames.get(id) ?? `${id.slice(0, 8)}…`,
        count,
        share_pct: b.den === 0 ? 0 : (count / b.den) * 100,
      }))
      .sort((a, b) => b.count - a.count);
    return {
      type: t,
      label: COMPANY_TYPE_LABEL[t],
      numerator: b.num,
      denominator: b.den,
      coverage_pct: b.den === 0 ? 0 : (b.num / b.den) * 100,
      by_member,
    };
  });

  return {
    rows,
    error: null,
    universe: scope.applied,
    sphereEmpty: scope.sphereEmpty,
  };
}

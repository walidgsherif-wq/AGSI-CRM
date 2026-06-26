'use server';

import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { serverComponentCookies } from '@/lib/supabase/cookie-adapter';
import { COMPANY_TYPE_LABEL } from '@/lib/zod/company';
import {
  BAND_THRESHOLD,
  SPOKE_TYPES,
  type CoverageRow,
  type SpokeType,
  type ValueBand,
} from '@/types/coverage';

function supabase() {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
    { cookies: serverComponentCookies(cookies()) },
  );
}

/**
 * Per-stakeholder-type coverage figures.
 *
 *   denominator = active companies of that type (or, when a value band
 *                 is set, active companies of that type linked to a
 *                 project with value_aed >= the band threshold).
 *   numerator   = same set, additionally constrained to owner_id IS NOT
 *                 NULL — companies the BD team has claimed.
 *   coverage    = numerator / denominator * 100.
 *
 * Aggregation runs server-side under the caller's RLS context.
 * companies / project_companies / projects all have transparent SELECT
 * for any authenticated user, so the totals are honest team-wide
 * counts regardless of who's viewing.
 */
export async function getCoverageByType(
  band: ValueBand = 'all',
): Promise<CoverageRow[]> {
  const sb = supabase();
  const threshold = BAND_THRESHOLD[band];

  // 1) Paginated fetch of active companies — only the columns we need.
  type CompanyMinimal = {
    id: string;
    company_type: SpokeType;
    owner_id: string | null;
  };
  const PAGE = 1000;
  const HARD_CAP = 20_000;
  const companies: CompanyMinimal[] = [];
  for (let offset = 0; offset < HARD_CAP; offset += PAGE) {
    const { data } = await sb
      .from('companies')
      .select('id, company_type, owner_id')
      .eq('is_active', true)
      .in('company_type', SPOKE_TYPES as unknown as string[])
      .order('id', { ascending: true })
      .range(offset, offset + PAGE - 1)
      .returns<CompanyMinimal[]>();
    const rows = data ?? [];
    companies.push(...rows);
    if (rows.length < PAGE) break;
  }

  // 2) Value-band filter. Distinct company_ids linked to a project with
  // value_aed >= threshold. PostgREST embedded filter (projects!inner +
  // .gte('projects.value_aed', ...)) keeps the join + filter in one
  // round-trip. Paginated for the same silent-cap reason.
  let companyIdsInBand: Set<string> | null = null;
  if (threshold !== null) {
    type PcRow = { company_id: string };
    companyIdsInBand = new Set<string>();
    for (let offset = 0; offset < HARD_CAP; offset += PAGE) {
      const { data } = await sb
        .from('project_companies')
        .select('company_id, projects!inner(value_aed)')
        .gte('projects.value_aed', threshold)
        .order('company_id', { ascending: true })
        .range(offset, offset + PAGE - 1)
        .returns<PcRow[]>();
      const rows = data ?? [];
      for (const r of rows) companyIdsInBand.add(r.company_id);
      if (rows.length < PAGE) break;
    }
  }

  // 3) Aggregate.
  const buckets: Record<SpokeType, { num: number; den: number }> = {
    developer: { num: 0, den: 0 },
    design_consultant: { num: 0, den: 0 },
    main_contractor: { num: 0, den: 0 },
    mep_consultant: { num: 0, den: 0 },
    mep_contractor: { num: 0, den: 0 },
    authority: { num: 0, den: 0 },
    society: { num: 0, den: 0 },
  };

  for (const c of companies) {
    if (companyIdsInBand && !companyIdsInBand.has(c.id)) continue;
    const b = buckets[c.company_type];
    if (!b) continue;
    b.den += 1;
    if (c.owner_id !== null) b.num += 1;
  }

  return SPOKE_TYPES.map((t) => {
    const { num, den } = buckets[t];
    return {
      type: t,
      label: COMPANY_TYPE_LABEL[t],
      numerator: num,
      denominator: den,
      coverage_pct: den === 0 ? 0 : (num / den) * 100,
    };
  });
}

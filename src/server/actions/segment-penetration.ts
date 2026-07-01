'use server';

import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { serverComponentCookies } from '@/lib/supabase/cookie-adapter';
import { COMPANY_TYPE_LABEL } from '@/lib/zod/company';
import {
  BAND_THRESHOLD,
  SPOKE_TYPES,
  type SpokeType,
  type ValueBand,
} from '@/types/coverage';
import { LEVELS, type Level } from '@/types/domain';
import type { SegmentPenetrationRow } from '@/lib/segment-penetration';

function supabase() {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
    { cookies: serverComponentCookies(cookies()) },
  );
}

/**
 * Per-stakeholder-type segment penetration: for each of the 7 spoke
 * types, over active + non-merged companies matching the value-band
 * filter, split into:
 *
 *   unclaimed  = companies with owner_id IS NULL
 *   by_level   = companies with owner_id IS NOT NULL grouped by
 *                current_level (L0..L5)
 *
 * Universe filter is byte-for-byte the same shape as
 * getCoverageByType — active, non-merged, band-restricted via
 * project_companies JOIN projects.value_aed. Sharing the same filter
 * with the coverage radar is what lets both panels stay in sync when
 * the user changes the band (their common signal is
 * notifyBandChanged / subscribeBandChanged in
 * src/lib/coverage-band-events.ts).
 *
 * Reads companies only (+ project_companies for value-band). No
 * schema change. RLS lets any authenticated user see these fields
 * transparently across the team, so team-wide totals are honest
 * regardless of viewer role.
 */
export async function getSegmentPenetration(
  band: ValueBand = 'all',
): Promise<SegmentPenetrationRow[]> {
  const sb = supabase();
  const threshold = BAND_THRESHOLD[band];

  // 1) Paginated fetch of active, non-merged companies. Same shape
  //    as getCoverageByType — extended with current_level for the
  //    ramp bucket.
  type CompanyMinimal = {
    id: string;
    company_type: SpokeType;
    owner_id: string | null;
    current_level: Level;
  };
  const PAGE = 1000;
  const HARD_CAP = 20_000;
  const companies: CompanyMinimal[] = [];
  for (let offset = 0; offset < HARD_CAP; offset += PAGE) {
    const { data } = await sb
      .from('companies')
      .select('id, company_type, owner_id, current_level')
      .eq('is_active', true)
      .is('merged_into_company_id', null)
      .in('company_type', SPOKE_TYPES as unknown as string[])
      .order('id', { ascending: true })
      .range(offset, offset + PAGE - 1)
      .returns<CompanyMinimal[]>();
    const rows = data ?? [];
    companies.push(...rows);
    if (rows.length < PAGE) break;
  }

  // 2) Value-band restriction — distinct company_ids linked to any
  //    project with value_aed >= threshold. Pattern verbatim from
  //    getCoverageByType.
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

  // 3) Bucket counts. One SegmentPenetrationRow per type.
  type Bucket = {
    total: number;
    unclaimed: number;
    by_level: Record<Level, number>;
  };
  const emptyLevelMap = (): Record<Level, number> => {
    const out = {} as Record<Level, number>;
    for (const l of LEVELS) out[l] = 0;
    return out;
  };
  const buckets: Record<SpokeType, Bucket> = {
    developer:         { total: 0, unclaimed: 0, by_level: emptyLevelMap() },
    design_consultant: { total: 0, unclaimed: 0, by_level: emptyLevelMap() },
    main_contractor:   { total: 0, unclaimed: 0, by_level: emptyLevelMap() },
    mep_consultant:    { total: 0, unclaimed: 0, by_level: emptyLevelMap() },
    mep_contractor:    { total: 0, unclaimed: 0, by_level: emptyLevelMap() },
    authority:         { total: 0, unclaimed: 0, by_level: emptyLevelMap() },
    society:           { total: 0, unclaimed: 0, by_level: emptyLevelMap() },
  };

  for (const c of companies) {
    if (companyIdsInBand && !companyIdsInBand.has(c.id)) continue;
    const b = buckets[c.company_type];
    if (!b) continue;
    b.total += 1;
    if (c.owner_id === null) {
      b.unclaimed += 1;
    } else {
      // Guard against any future currentLevel-outside-enum drift.
      const level = (LEVELS as readonly string[]).includes(c.current_level)
        ? c.current_level
        : 'L0';
      b.by_level[level] = (b.by_level[level] ?? 0) + 1;
    }
  }

  return SPOKE_TYPES.map((t) => {
    const b = buckets[t];
    return {
      type: t,
      label: COMPANY_TYPE_LABEL[t],
      total: b.total,
      unclaimed: b.unclaimed,
      by_level: b.by_level,
    };
  });
}

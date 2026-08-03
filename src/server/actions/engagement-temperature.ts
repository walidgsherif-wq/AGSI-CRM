'use server';

import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { serverComponentCookies } from '@/lib/supabase/cookie-adapter';
import { getCurrentUser } from '@/lib/auth/get-user';
import {
  ENGAGEMENT_TYPE_ORDER,
  emptyEngagementGrid,
  normaliseBand,
  type EngagementMeasure,
  type EngagementRowType,
  type EngagementTemperature,
  type EngagementBreadth,
} from '@/lib/engagement-temperature';
import type { Universe } from '@/types/coverage';
import { resolveSphereScope } from '@/lib/sphere-scope';

function supabase() {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
    { cookies: serverComponentCookies(cookies()) },
  );
}

type RawGridRow = {
  company_type: string;
  band: string;
  cnt: number;
};

type RawPayload = {
  breadth: EngagementBreadth | null;
  grid: RawGridRow[] | null;
};

/**
 * Fetch the engagement-temperature board (breadth + grid) via the
 * SECURITY DEFINER RPC (migration 0089). The RPC checks auth_role()
 * and rejects bd_manager before touching the tables; we
 * short-circuit at the action layer too so we don't spend a round
 * trip for a role that shouldn't see the panel.
 */
export async function getEngagementTemperature(
  measure: EngagementMeasure,
  universe: Universe = 'sphere',
): Promise<EngagementTemperature | { error: string }> {
  const user = await getCurrentUser();
  if (user.role === 'bd_manager') return { error: 'forbidden' };

  const sb = supabase();
  const scope = await resolveSphereScope(sb, universe);

  const { data, error } = await sb.rpc('get_engagement_temperature', {
    p_measure: measure,
    p_sphere_only: scope.applied === 'sphere',
  });
  if (error) return { error: error.message };

  const payload = (data as RawPayload | null) ?? { breadth: null, grid: null };

  const breadth: EngagementBreadth = payload.breadth ?? {
    total: 0,
    engaged: 0,
    active: 0,
    cooling: 0,
    untouched: 0,
  };

  const grid = emptyEngagementGrid();
  let cellMax = 0;
  for (const row of payload.grid ?? []) {
    if (!(ENGAGEMENT_TYPE_ORDER as readonly string[]).includes(row.company_type)) {
      continue;
    }
    const band = normaliseBand(row.band);
    if (!band) continue;
    const type = row.company_type as EngagementRowType;
    grid[type][band] = row.cnt;
    if (row.cnt > cellMax) cellMax = row.cnt;
  }

  return {
    measure,
    breadth,
    grid,
    cellMax,
    universe: scope.applied,
    sphereEmpty: scope.sphereEmpty,
  };
}

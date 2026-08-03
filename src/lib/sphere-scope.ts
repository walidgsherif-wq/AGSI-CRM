// Shared sphere-scoping helper for the four dashboard metric
// actions (coverage, penetration, temperature, market-value). Lives
// outside any 'use server' module so it can be reused freely.

import type { Universe } from '@/types/coverage';

export type SphereScope = {
  /** Requested 'sphere' | 'full' from the caller. */
  requested: Universe;
  /** Actual scope applied after fallback ('sphere' → 'full' when empty). */
  applied: Universe;
  /** True when the caller asked for sphere but nothing was defined yet. */
  sphereEmpty: boolean;
  /** Populated only when `applied === 'sphere'` — the target id set. */
  memberIds: Set<string> | null;
};

/**
 * Resolve a sphere scope by consulting sphere_members. Returns the
 * member id set for SDK-side filtering + a fallback flag the panels
 * use to render a "showing full universe" notice instead of a false
 * 0-of-0. RPC-based callers use `applied === 'sphere'` to decide
 * whether to pass p_sphere_only=true.
 */
// The sb parameter is a Supabase browser/server client. The full
// generic type from @supabase/supabase-js is heavy and unstable across
// versions; the callsites all pass a real client, so `unknown` here
// + a local cast keeps type safety at the callsite without dragging
// the postgrest-js builder types into this leaf module.
type SbLike = {
  from: (t: string) => {
    select: (cols: string) => unknown;
  };
};

export async function resolveSphereScope(
  sb: unknown,
  requested: Universe,
): Promise<SphereScope> {
  if (requested !== 'sphere') {
    return {
      requested,
      applied: 'full',
      sphereEmpty: false,
      memberIds: null,
    };
  }
  const client = sb as SbLike;
  const { data } = (await client
    .from('sphere_members')
    .select('company_id')) as { data: Array<{ company_id: string }> | null };
  const ids = new Set<string>((data ?? []).map((r) => r.company_id));
  if (ids.size === 0) {
    return {
      requested: 'sphere',
      applied: 'full',
      sphereEmpty: true,
      memberIds: null,
    };
  }
  return {
    requested: 'sphere',
    applied: 'sphere',
    sphereEmpty: false,
    memberIds: ids,
  };
}

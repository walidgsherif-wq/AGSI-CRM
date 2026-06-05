import { notFound } from 'next/navigation';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import type { Role } from '@/types/domain';
import { serverComponentCookies } from '@/lib/supabase/cookie-adapter';
import { getCurrentUser, type CurrentUser } from './get-user';

export type FeatureKey =
  | 'insights'
  | 'insights_maps'
  | 'insights_ecosystem'
  | 'reports'
  | 'pipeline'
  | 'tasks';

export type FeatureDef = {
  key: FeatureKey;
  label: string;
  description: string;
  /** Roles that get this feature when no per-user override exists. */
  defaultRoles: Role[];
};

/**
 * Mirror of the `features` registry seeded in migration 0047. Kept in
 * code so route guards + the sidebar can compute defaults without a DB
 * round-trip for every render. The DB row is the source of truth for
 * RLS; this list must stay in sync with the seed.
 */
export const FEATURES: FeatureDef[] = [
  {
    key: 'insights',
    label: 'Market insights',
    description: 'The /insights market dashboard (BNC snapshot metrics).',
    defaultRoles: ['admin', 'leadership', 'bd_head', 'bd_manager'],
  },
  {
    key: 'insights_maps',
    label: 'Insight maps',
    description: 'Geographic / level-distribution / engagement-freshness maps.',
    defaultRoles: ['admin', 'leadership', 'bd_head'],
  },
  {
    key: 'insights_ecosystem',
    label: 'Ecosystem awareness',
    description: 'The ecosystem awareness engine views + event scoring.',
    defaultRoles: ['admin', 'leadership', 'bd_head'],
  },
  {
    key: 'reports',
    label: 'Leadership reports',
    description: 'Finalised/archived leadership reports + PDF download.',
    defaultRoles: ['admin', 'leadership', 'bd_head'],
  },
  {
    key: 'pipeline',
    label: 'Pipeline board',
    description: 'The /pipeline kanban of accounts by level.',
    defaultRoles: ['admin', 'bd_head', 'bd_manager'],
  },
  {
    key: 'tasks',
    label: 'Tasks',
    description: 'The /tasks list + task management.',
    defaultRoles: ['admin', 'bd_head', 'bd_manager'],
  },
];

const ALL_KEYS = FEATURES.map((f) => f.key);

function supabase() {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
    { cookies: serverComponentCookies(cookies()) },
  );
}

/**
 * Computes the set of features a user can access: admins get all;
 * everyone else gets role defaults with per-user overrides applied.
 */
export async function getFeatureAccess(user?: CurrentUser): Promise<Set<FeatureKey>> {
  const u = user ?? (await getCurrentUser());
  if (u.role === 'admin') return new Set(ALL_KEYS);

  const { data } = await supabase()
    .from('feature_access')
    .select('feature_key, allowed')
    .eq('user_id', u.id);

  const overrides = new Map<string, boolean>(
    (data ?? []).map((r) => [r.feature_key as string, r.allowed as boolean]),
  );

  const allowed = new Set<FeatureKey>();
  for (const f of FEATURES) {
    const override = overrides.get(f.key);
    const ok = override !== undefined ? override : f.defaultRoles.includes(u.role);
    if (ok) allowed.add(f.key);
  }
  return allowed;
}

/**
 * Server-component guard. 404s the route when the current user lacks
 * the feature. Returns the current user when allowed.
 */
export async function requireFeature(key: FeatureKey): Promise<CurrentUser> {
  const user = await getCurrentUser();
  const allowed = await getFeatureAccess(user);
  if (!allowed.has(key)) notFound();
  return user;
}

import type { SupabaseClient } from '@supabase/supabase-js';

export type OwnerOption = { id: string; full_name: string };

/**
 * BD-member profile list used to populate owner / assignee dropdowns
 * across the app. Filters to the ops trio (admin / bd_head /
 * bd_manager) and active profiles only.
 *
 * Surfaces using this:
 *   /pipeline                 (this PR)
 *   /companies (FX-024b)      — same query inline today; can adopt later
 *   /companies/[id]/tasks     — same query inline today
 *   /tasks (FX-014c)          — same query inline today
 *   /tasks/oversight (FX-025) — same query inline today
 *
 * Spec for this PR forbids touching Companies; the other surfaces are
 * fine to migrate when convenient. Until then this helper is the
 * single source of truth for new callers.
 */
export async function fetchOwnerOptions(
  supabase: SupabaseClient,
): Promise<OwnerOption[]> {
  const { data } = await supabase
    .from('profiles')
    .select('id, full_name')
    .eq('is_active', true)
    .in('role', ['admin', 'bd_head', 'bd_manager'])
    .order('full_name');
  return (data ?? []) as OwnerOption[];
}

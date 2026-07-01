'use server';

import { revalidatePath } from 'next/cache';
import { updateAppSetting } from '@/server/actions/admin-settings';
import { getCurrentUser } from '@/lib/auth/get-user';

/**
 * Admin toggle. Writes app_settings.crm_setup_mode via the existing
 * update_app_setting_with_audit RPC so the who/when is captured in
 * audit_events alongside the value change.
 *
 * When ON, level-change REQUESTS may skip levels (e.g. L0 → L4 in a
 * single request) but admin approval is still required for every
 * forward move. The completeness gate still applies. Approved
 * multi-level requests write level_history.source = 'initial_backfill'
 * so they do not credit earned Driver A. See migration 0086 for the
 * DB-side relaxation.
 *
 * There is deliberately NO direct-write path (set_initial_level was
 * dropped in 0086). Owners cannot set levels directly, even during
 * initial CRM setup — approval must gate every forward move.
 */
export async function setCrmSetupMode(enabled: boolean) {
  const user = await getCurrentUser();
  if (user.role !== 'admin') return { error: 'Only admin can toggle CRM setup mode.' };
  const r = await updateAppSetting('crm_setup_mode', enabled);
  if ('error' in r) return { error: r.error };
  // The banner is layout-level and every page reads it; invalidate the
  // whole authenticated tree cheaply.
  revalidatePath('/', 'layout');
  return { ok: true as const };
}

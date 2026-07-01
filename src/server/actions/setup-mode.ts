'use server';

import { revalidatePath } from 'next/cache';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { serverComponentCookies } from '@/lib/supabase/cookie-adapter';
import { getCurrentUser } from '@/lib/auth/get-user';
import type { Level } from '@/types/domain';
import { updateAppSetting } from '@/server/actions/admin-settings';

function supabase() {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
    { cookies: serverComponentCookies(cookies()) },
  );
}

/**
 * Admin toggle. Writes app_settings.crm_setup_mode via the existing
 * update_app_setting_with_audit RPC so the who/when is captured in
 * audit_events alongside the value change.
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

/**
 * Owner backfill. Guards live in the RPC; the client only formats the
 * inputs. Returns the created level_history id on success or the
 * error message from Postgres verbatim (so gate messages flow to UI).
 */
export async function setInitialLevel(input: {
  companyId: string;
  toLevel: Level;
  note: string;
}) {
  await getCurrentUser();
  const note = input.note.trim();
  const { data, error } = await supabase().rpc('set_initial_level', {
    p_company: input.companyId,
    p_to_level: input.toLevel,
    p_note: note.length > 0 ? note : null,
  });
  if (error) return { error: error.message };
  revalidatePath(`/companies/${input.companyId}`);
  revalidatePath('/companies');
  revalidatePath('/pipeline');
  return { ok: true as const, historyId: data as string };
}

'use server';

import { revalidatePath } from 'next/cache';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { serverComponentCookies } from '@/lib/supabase/cookie-adapter';
import { getCurrentUser } from '@/lib/auth/get-user';

export type ActionResult = { ok: true } | { error: string };

function supabase() {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
    { cookies: serverComponentCookies(cookies()) },
  );
}

async function assertAdmin() {
  const user = await getCurrentUser();
  if (user.role !== 'admin') throw new Error('admin only');
}

function revalidate() {
  revalidatePath('/admin/settings');
  // Most settings affect /dashboard, /insights, /admin/notifications-eval, etc.
  // Cheap to invalidate the whole authenticated tree.
  revalidatePath('/admin');
  revalidatePath('/dashboard');
  revalidatePath('/insights');
}

// =====================================================================
// app_settings — generic key/value updater
// =====================================================================

export async function updateAppSetting(
  key: string,
  valueJson: unknown,
): Promise<ActionResult> {
  await assertAdmin();
  const { error } = await supabase().rpc('update_app_setting_with_audit', {
    p_key: key,
    p_value_json: valueJson,
  });
  if (error) return { error: error.message };
  revalidate();
  return { ok: true };
}

// Specialised wrappers — call updateAppSetting with the right key + a
// validated value shape. Each returns { ok: true } | { error: string }.

export async function updateBeiWeightings(weightings: {
  A: number;
  B: number;
  C: number;
  D: number;
}): Promise<ActionResult> {
  const sum = weightings.A + weightings.B + weightings.C + weightings.D;
  if (sum !== 100) {
    return { error: `BEI weightings must sum to 100 (got ${sum}).` };
  }
  return updateAppSetting('bei_weightings', weightings);
}

export async function updateKpiUniverseSizes(sizes: {
  developers: number;
  consultants: number;
  main_contractors: number;
  enabling_contractors: number;
}): Promise<ActionResult> {
  const total =
    sizes.developers +
    sizes.consultants +
    sizes.main_contractors +
    sizes.enabling_contractors;
  return updateAppSetting('kpi_universe_sizes', { ...sizes, total });
}

export async function updateFiscalYearStartMonth(month: number): Promise<ActionResult> {
  if (month < 1 || month > 12) return { error: 'Month must be 1–12.' };
  return updateAppSetting('fiscal_year_start_month', { month });
}

export async function updateCompositionWarning(thresholds: {
  headline_pct: number;
  composition_pct: number;
}): Promise<ActionResult> {
  return updateAppSetting('composition_warning_thresholds', thresholds);
}

export async function updateCompositionDrift(values: {
  min_quarter_pct: number;
  min_sample_size: number;
  ratio_threshold: number;
  cooldown_days: number;
}): Promise<ActionResult> {
  // Each setting is its own app_setting key.
  const calls = await Promise.all([
    updateAppSetting('composition_drift_min_quarter_pct', { pct: values.min_quarter_pct }),
    updateAppSetting('composition_drift_min_sample_size', { n: values.min_sample_size }),
    updateAppSetting('composition_drift_ratio_threshold', { ratio: values.ratio_threshold }),
    updateAppSetting('composition_drift_cooldown_days', { days: values.cooldown_days }),
  ]);
  const firstError = calls.find((r): r is { error: string } => 'error' in r);
  if (firstError) return firstError;
  return { ok: true };
}

export async function updateEcosystemTuning(values: {
  decay_window_days: number;
  inactive_company_multiplier: number;
  dedup_window_days: number;
}): Promise<ActionResult> {
  const calls = await Promise.all([
    updateAppSetting('ecosystem_decay_window_days', { days: values.decay_window_days }),
    updateAppSetting('ecosystem_inactive_company_multiplier', {
      mult: values.inactive_company_multiplier,
    }),
    updateAppSetting('ecosystem_dedup_window_days', { days: values.dedup_window_days }),
  ]);
  const firstError = calls.find((r): r is { error: string } => 'error' in r);
  if (firstError) return firstError;
  return { ok: true };
}

export async function updateRebarSettings(values: {
  window_pct: number;
  share_of_value: number;
  price_per_tonne_aed: number;
}): Promise<ActionResult> {
  const calls = await Promise.all([
    updateAppSetting('rebar_consumption_window_pct', { pct: values.window_pct }),
    updateAppSetting('rebar_share_of_project_value', { share: values.share_of_value }),
    updateAppSetting('rebar_price_per_tonne_aed', { price: values.price_per_tonne_aed }),
  ]);
  const firstError = calls.find((r): r is { error: string } => 'error' in r);
  if (firstError) return firstError;
  return { ok: true };
}

// =====================================================================
// stagnation_rules
// =====================================================================

export async function updateStagnationRule(rule: {
  level: 'L0' | 'L1' | 'L2' | 'L3' | 'L4' | 'L5';
  max_days_in_level: number;
  warn_at_pct: number;
  escalate_at_pct: number;
  escalation_role: 'bd_head' | 'admin';
  is_active: boolean;
}): Promise<ActionResult> {
  await assertAdmin();
  if (rule.escalate_at_pct < rule.warn_at_pct) {
    return { error: 'escalate_at_pct must be ≥ warn_at_pct.' };
  }
  const { error } = await supabase().rpc('update_stagnation_rule_with_audit', {
    p_level: rule.level,
    p_max_days: rule.max_days_in_level,
    p_warn_at_pct: rule.warn_at_pct,
    p_escalate_at_pct: rule.escalate_at_pct,
    p_escalation_role: rule.escalation_role,
    p_is_active: rule.is_active,
  });
  if (error) return { error: error.message };
  revalidate();
  return { ok: true };
}

// =====================================================================
// ecosystem_point_scale
// =====================================================================

export async function updateEcosystemPoint(
  category: string,
  subtype: string,
  pointsCurrent: number,
): Promise<ActionResult> {
  await assertAdmin();
  if (pointsCurrent < 0) return { error: 'Points must be ≥ 0.' };
  const { error } = await supabase().rpc('update_ecosystem_point_with_audit', {
    p_event_category: category,
    p_event_subtype: subtype,
    p_points_current: pointsCurrent,
  });
  if (error) return { error: error.message };
  revalidate();
  return { ok: true };
}

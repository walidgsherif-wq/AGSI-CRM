import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { serverComponentCookies } from '@/lib/supabase/cookie-adapter';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { StagnationRulesEditor } from './_components/StagnationRulesEditor';
import { FiscalYearCard } from './_components/FiscalYearCard';
import { UniverseSizesCard } from './_components/UniverseSizesCard';
import { CompositionCard } from './_components/CompositionCard';
import { EcosystemTuningCard } from './_components/EcosystemTuningCard';
import { BeiWeightingsCard } from './_components/BeiWeightingsCard';
import { RebarCard } from './_components/RebarCard';
import { EcosystemPointScaleCard } from './_components/EcosystemPointScaleCard';

export const dynamic = 'force-dynamic';

type StagnationRule = {
  level: 'L0' | 'L1' | 'L2' | 'L3' | 'L4' | 'L5';
  max_days_in_level: number;
  warn_at_pct: number;
  escalate_at_pct: number;
  escalation_role: 'bd_head' | 'admin';
  is_active: boolean;
};

type EcosystemPoint = {
  id: string;
  event_category: string;
  event_subtype: string;
  points_default: number;
  points_current: number;
};

type Setting = { key: string; value_json: Record<string, unknown> };

function get<T = unknown>(map: Map<string, Record<string, unknown>>, key: string): T | undefined {
  return map.get(key) as T | undefined;
}

export default async function AdminSettingsPage() {
  // Admin layout already enforces requireRole(['admin']).
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
    { cookies: serverComponentCookies(cookies()) },
  );

  const [rulesRes, settingsRes, pointsRes] = await Promise.all([
    supabase
      .from('stagnation_rules')
      .select('level, max_days_in_level, warn_at_pct, escalate_at_pct, escalation_role, is_active')
      .order('level')
      .returns<StagnationRule[]>(),
    supabase
      .from('app_settings')
      .select('key, value_json')
      .returns<Setting[]>(),
    supabase
      .from('ecosystem_point_scale')
      .select('id, event_category, event_subtype, points_default, points_current')
      .order('event_category')
      .order('event_subtype')
      .returns<EcosystemPoint[]>(),
  ]);

  const settingsMap = new Map<string, Record<string, unknown>>();
  for (const s of settingsRes.data ?? []) settingsMap.set(s.key, s.value_json ?? {});

  const fyMonth = Number(get<{ month?: number }>(settingsMap, 'fiscal_year_start_month')?.month ?? 1);
  const universe = (get<{
    developers?: number;
    consultants?: number;
    main_contractors?: number;
    enabling_contractors?: number;
  }>(settingsMap, 'kpi_universe_sizes') ?? {});
  const compWarn = (get<{ headline_pct?: number; composition_pct?: number }>(
    settingsMap,
    'composition_warning_thresholds',
  ) ?? {});
  const drift = {
    min_quarter_pct: Number(get<{ pct?: number }>(settingsMap, 'composition_drift_min_quarter_pct')?.pct ?? 30),
    min_sample_size: Number(get<{ n?: number }>(settingsMap, 'composition_drift_min_sample_size')?.n ?? 5),
    ratio_threshold: Number(get<{ ratio?: number }>(settingsMap, 'composition_drift_ratio_threshold')?.ratio ?? 0.7),
    cooldown_days: Number(get<{ days?: number }>(settingsMap, 'composition_drift_cooldown_days')?.days ?? 14),
  };
  const eco = {
    decay_window_days: Number(get<{ days?: number }>(settingsMap, 'ecosystem_decay_window_days')?.days ?? 90),
    inactive_company_multiplier: Number(
      get<{ mult?: number }>(settingsMap, 'ecosystem_inactive_company_multiplier')?.mult ?? 0.5,
    ),
    dedup_window_days: Number(get<{ days?: number }>(settingsMap, 'ecosystem_dedup_window_days')?.days ?? 7),
  };
  const bei = (get<{ A?: number; B?: number; C?: number; D?: number }>(
    settingsMap,
    'bei_weightings',
  ) ?? {});
  const rebar = {
    window_pct: Number(get<{ pct?: number }>(settingsMap, 'rebar_consumption_window_pct')?.pct ?? 45),
    share_of_value: Number(get<{ share?: number }>(settingsMap, 'rebar_share_of_project_value')?.share ?? 0.05),
    price_per_tonne_aed: Number(get<{ price?: number }>(settingsMap, 'rebar_price_per_tonne_aed')?.price ?? 2400),
  };
  const channels = get<{ in_app?: boolean; email?: boolean; whatsapp?: boolean }>(
    settingsMap,
    'notification_channels_enabled',
  ) ?? { in_app: true, email: false, whatsapp: false };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-agsi-navy">System settings</h1>
        <p className="mt-1 text-sm text-agsi-darkGray">
          Tunable configuration. Every save writes an entry to{' '}
          <a href="/admin/audit" className="text-agsi-accent hover:underline">
            audit_events
          </a>{' '}
          so changes are reviewable.
        </p>
      </div>

      <FiscalYearCard initialMonth={fyMonth} />
      <UniverseSizesCard
        initialDevelopers={Number(universe.developers ?? 0)}
        initialConsultants={Number(universe.consultants ?? 0)}
        initialMainContractors={Number(universe.main_contractors ?? 0)}
        initialEnablingContractors={Number(universe.enabling_contractors ?? 0)}
      />
      <BeiWeightingsCard
        initialA={Number(bei.A ?? 45)}
        initialB={Number(bei.B ?? 20)}
        initialC={Number(bei.C ?? 20)}
        initialD={Number(bei.D ?? 15)}
      />
      <CompositionCard
        initialHeadlinePct={Number(compWarn.headline_pct ?? 80)}
        initialCompositionPct={Number(compWarn.composition_pct ?? 60)}
        initialDrift={drift}
      />
      <EcosystemTuningCard initial={eco} />
      <RebarCard initial={rebar} />

      <Card>
        <CardHeader>
          <CardTitle>Stagnation rules</CardTitle>
          <CardDescription>
            Per L-level threshold for when the stagnation eval fires{' '}
            <code>stagnation_warning</code> + <code>stagnation_breach</code>. Edit
            inline; each row saves independently.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <StagnationRulesEditor rules={rulesRes.data ?? []} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Ecosystem point scale</CardTitle>
          <CardDescription>
            Admin override of the seed default points awarded per event. Affects
            future ecosystem_events; historical events retain their original
            point value.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <EcosystemPointScaleCard rows={pointsRes.data ?? []} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Notification channels</CardTitle>
          <CardDescription>
            Channel-level on/off. Per-type opt-out lives at{' '}
            <a href="/settings/notifications" className="text-agsi-accent hover:underline">
              /settings/notifications
            </a>
            .
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="space-y-1 text-sm">
            <li className="flex items-center gap-2">
              <span className="font-medium text-agsi-navy">In-app</span>
              <Badge variant={channels.in_app ? 'green' : 'neutral'}>
                {channels.in_app ? 'Enabled' : 'Disabled'}
              </Badge>
            </li>
            <li className="flex items-center gap-2">
              <span className="font-medium text-agsi-navy">Email</span>
              <Badge variant="neutral">v1.1 (deferred per §16 D-3)</Badge>
            </li>
            <li className="flex items-center gap-2">
              <span className="font-medium text-agsi-navy">WhatsApp</span>
              <Badge variant="neutral">v1.1 (out of v1 scope)</Badge>
            </li>
          </ul>
          <p className="mt-3 text-xs text-agsi-darkGray">
            Email + WhatsApp toggles are intentionally not editable in v1 — those
            channels need delivery wiring (Resend, Meta API). They&apos;ll become
            editable when the channels are actually delivering.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

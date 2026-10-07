import { requireFeature } from '@/lib/auth/features';
import { Card, CardContent } from '@/components/ui/card';
import { MarketValueEngagementPanel } from './_components/MarketValueEngagementPanel';
import { EngagementTemperaturePanel } from './_components/EngagementTemperaturePanel';
import { SegmentPenetrationPanel } from './_components/SegmentPenetrationPanel';
import { CoverageRadarPanel } from './_components/CoverageRadarPanel';
import { getMarketValueEngagement } from '@/server/actions/market-value-engagement';
import { getEngagementTemperature } from '@/server/actions/engagement-temperature';
import { getSegmentPenetration } from '@/server/actions/segment-penetration';
import { getCoverageByType } from '@/server/actions/coverage';
import {
  getCoverageDiagnostics,
  type CoverageDiagnostics,
} from '@/server/actions/coverage-diagnostics';
import { InsightsSubNav } from '../_components/InsightsSubNav';

export const dynamic = 'force-dynamic';

export default async function InsightsEngagementPage({
  searchParams,
}: {
  searchParams: { debug?: string };
}) {
  // Phase 1a relocation: this page carries the four BD-engagement
  // panels that lived on the dashboard until §10.1 of the KPI target
  // model spec moved them here. The `insights` feature default already
  // includes bd_manager (unlike `reports`), so bd_managers reach this
  // page too — the per-panel role gates below mirror the dashboard's
  // pre-move behaviour exactly.
  const user = await requireFeature('insights');

  const initialPenetration = await getSegmentPenetration('all');
  const initialCoverage = await getCoverageByType('all');

  // Step-0 diagnostic — only prefetched when ?debug=coverage AND the
  // caller is admin/bd_head/leadership (RPC also gates server-side).
  // Moved from the dashboard with the coverage data it debugs.
  const wantsCoverageDebug =
    (searchParams.debug ?? '').toLowerCase() === 'coverage';
  const coverageDebug =
    wantsCoverageDebug && ['admin', 'bd_head', 'leadership'].includes(user.role)
      ? await getCoverageDiagnostics()
      : null;

  // Engagement-temperature initial snapshot (companies mode). Only
  // fetched for roles that see the panel. Client re-fetches when the
  // user switches the Measure dropdown.
  const initialTemperatureRaw =
    user.role !== 'bd_manager'
      ? await getEngagementTemperature('companies')
      : null;
  const initialTemperature =
    initialTemperatureRaw && !('error' in initialTemperatureRaw)
      ? initialTemperatureRaw
      : null;

  // Value-weighted engagement panel — same role gate as the temperature
  // board; get_market_value_engagement() (0091) also blocks bd_manager
  // server-side.
  const initialMarketValueRaw =
    user.role !== 'bd_manager'
      ? await getMarketValueEngagement()
      : null;
  const initialMarketValue =
    initialMarketValueRaw && !('error' in initialMarketValueRaw)
      ? initialMarketValueRaw
      : null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-agsi-navy">Engagement</h1>
        <p className="mt-1 text-sm text-agsi-darkGray">
          Who in the sphere we are actually reaching, how recently, and by how
          much value. Market-snapshot data lives on the main Insights page.
        </p>
      </div>

      <InsightsSubNav active="engagement" />

      {coverageDebug && <CoverageDebugBanner data={coverageDebug} />}

      {user.role !== 'bd_manager' && initialMarketValue && (
        <MarketValueEngagementPanel data={initialMarketValue} />
      )}

      {user.role !== 'bd_manager' && initialTemperature && (
        <EngagementTemperaturePanel initial={initialTemperature} />
      )}

      <SegmentPenetrationPanel initial={initialPenetration} initialBand="all" />

      <CoverageRadarPanel initial={initialCoverage} initialBand="all" />
    </div>
  );
}

function CoverageDebugBanner({
  data,
}: {
  data: CoverageDiagnostics | { error: string };
}) {
  if ('error' in data) {
    return (
      <Card>
        <CardContent className="p-3 text-xs text-rag-red">
          <strong>Coverage diagnostics failed:</strong> {data.error}
        </CardContent>
      </Card>
    );
  }
  return (
    <Card>
      <CardContent className="space-y-2 p-3 text-xs text-agsi-darkGray">
        <p className="font-medium text-agsi-navy">
          Coverage diagnostics (?debug=coverage) — companies row counts
        </p>
        <ul className="grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-4 tabular-nums">
          <li>total: <strong className="text-agsi-navy">{data.total}</strong></li>
          <li>is_active=true: <strong className="text-agsi-navy">{data.is_active_true}</strong></li>
          <li>is_active≠true: <strong className="text-agsi-navy">{data.is_active_not_true}</strong></li>
          <li>merged NULL: <strong className="text-agsi-navy">{data.merged_null}</strong></li>
          <li>merged NOT NULL: <strong className="text-agsi-navy">{data.merged_not_null}</strong></li>
          <li>all-three-filter survivors: <strong className="text-agsi-navy">{data.all_three_filters}</strong></li>
          <li>universe owner NULL: <strong className="text-agsi-navy">{data.owner_null_in_universe}</strong></li>
          <li>universe owner NOT NULL: <strong className="text-agsi-navy">{data.owner_not_null_in_universe}</strong></li>
        </ul>
        <div>
          <p className="mt-2 font-medium text-agsi-navy">by_type (all rows):</p>
          <pre className="overflow-x-auto rounded bg-agsi-offWhite/60 p-2">{JSON.stringify(data.by_type, null, 2)}</pre>
        </div>
        <div>
          <p className="mt-2 font-medium text-agsi-navy">by_type_survivors (after all 3 filters):</p>
          <pre className="overflow-x-auto rounded bg-agsi-offWhite/60 p-2">{JSON.stringify(data.by_type_survivors, null, 2)}</pre>
        </div>
      </CardContent>
    </Card>
  );
}

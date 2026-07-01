'use client';

import { useState, useTransition } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getEngagementTemperature } from '@/server/actions/engagement-temperature';
import {
  BAND_ORDER,
  ENGAGEMENT_TYPE_LABEL,
  ENGAGEMENT_TYPE_ORDER,
  type Band,
  type EngagementMeasure,
  type EngagementRowType,
  type EngagementTemperature,
} from '@/lib/engagement-temperature';

const BAND_HEADER: Record<Band, string> = {
  hot: 'Hot',
  warm: 'Warm',
  cooling: 'Cooling',
  tail: 'Cold / none', // relabelled below when measure = events
};

const BAND_SUBTITLE: Record<Band, string> = {
  hot: '≤30d',
  warm: '30–90d',
  cooling: '90–180d',
  tail: '',
};

export function EngagementTemperaturePanel({
  initial,
}: {
  initial: EngagementTemperature;
}) {
  const [snapshot, setSnapshot] = useState<EngagementTemperature>(initial);
  const [measure, setMeasure] = useState<EngagementMeasure>(initial.measure);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onMeasureChange(next: EngagementMeasure) {
    if (next === measure) return;
    setMeasure(next);
    setError(null);
    startTransition(async () => {
      const r = await getEngagementTemperature(next);
      if ('error' in r) {
        setError(r.error);
        return;
      }
      setSnapshot(r);
    });
  }

  const tailLabel = snapshot.measure === 'companies' ? 'Cold / none' : 'Older';
  const tailSubtitle = snapshot.measure === 'companies' ? 'no event / >180d' : '>180d';
  const bandHeader: Record<Band, string> = {
    ...BAND_HEADER,
    tail: tailLabel,
  };
  const bandSubtitle: Record<Band, string> = {
    ...BAND_SUBTITLE,
    tail: tailSubtitle,
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle>Engagement temperature</CardTitle>
            <CardDescription>
              Outreach + level-up events over the 7-type stakeholder
              universe. Rows are stakeholder types; columns are recency
              bands from last event.
            </CardDescription>
          </div>
          <label className="flex items-center gap-2 text-xs text-agsi-darkGray">
            Measure:
            <select
              value={measure}
              disabled={pending}
              onChange={(e) => onMeasureChange(e.target.value as EngagementMeasure)}
              className="rounded border border-agsi-midGray bg-white px-2 py-1 text-xs text-agsi-navy"
            >
              <option value="companies">Companies</option>
              <option value="events">Engagements</option>
            </select>
          </label>
        </div>
      </CardHeader>
      <CardContent>
        <BreadthStrip breadth={snapshot.breadth} />

        <div className="mt-4 overflow-x-auto">
          <TemperatureGrid
            grid={snapshot.grid}
            cellMax={snapshot.cellMax}
            bandHeader={bandHeader}
            bandSubtitle={bandSubtitle}
            measure={snapshot.measure}
            loading={pending}
          />
        </div>

        {error && (
          <p className="mt-2 text-xs text-rag-red">Refresh failed: {error}</p>
        )}
      </CardContent>
    </Card>
  );
}

function BreadthStrip({
  breadth,
}: {
  breadth: EngagementTemperature['breadth'];
}) {
  const denom = breadth.total.toLocaleString();
  return (
    <div className="grid gap-3 sm:grid-cols-4">
      <BreadthTile
        label="Engaged"
        value={breadth.engaged}
        denom={denom}
        tone="green"
      />
      <BreadthTile
        label="Active (last 90d)"
        value={breadth.active}
        denom={denom}
        tone="blue"
      />
      <BreadthTile
        label="Cooling (90–180d)"
        value={breadth.cooling}
        denom={denom}
        tone="amber"
      />
      <BreadthTile
        label="Untouched"
        value={breadth.untouched}
        denom={denom}
        tone="neutral"
      />
    </div>
  );
}

function BreadthTile({
  label,
  value,
  denom,
  tone,
}: {
  label: string;
  value: number;
  denom: string;
  tone: 'green' | 'blue' | 'amber' | 'neutral';
}) {
  const toneClass =
    tone === 'green'
      ? 'text-agsi-green'
      : tone === 'blue'
        ? 'text-agsi-accent'
        : tone === 'amber'
          ? 'text-rag-amber'
          : 'text-agsi-navy';
  return (
    <div className="rounded-lg border border-agsi-lightGray p-3">
      <p className="text-xs font-medium uppercase tracking-wide text-agsi-darkGray">
        {label}
      </p>
      <p className={`mt-1 text-2xl font-semibold tabular-nums ${toneClass}`}>
        {value.toLocaleString()}
      </p>
      <p className="text-xxs text-agsi-darkGray">of {denom}</p>
    </div>
  );
}

function TemperatureGrid({
  grid,
  cellMax,
  bandHeader,
  bandSubtitle,
  measure,
  loading,
}: {
  grid: EngagementTemperature['grid'];
  cellMax: number;
  bandHeader: Record<Band, string>;
  bandSubtitle: Record<Band, string>;
  measure: EngagementMeasure;
  loading: boolean;
}) {
  return (
    <table
      className={
        loading
          ? 'w-full min-w-[520px] table-fixed text-xs opacity-60 transition-opacity'
          : 'w-full min-w-[520px] table-fixed text-xs transition-opacity'
      }
    >
      <thead>
        <tr>
          <th className="pb-2 pr-3 text-left font-medium text-agsi-darkGray">
            Stakeholder type
          </th>
          {BAND_ORDER.map((b) => (
            <th key={b} className="pb-2 px-1 text-center font-medium text-agsi-darkGray">
              <div>{bandHeader[b]}</div>
              {bandSubtitle[b] && (
                <div className="text-xxs font-normal text-agsi-midGray">
                  {bandSubtitle[b]}
                </div>
              )}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {ENGAGEMENT_TYPE_ORDER.map((t) => (
          <TypeRow
            key={t}
            type={t}
            row={grid[t]}
            cellMax={cellMax}
            measure={measure}
          />
        ))}
      </tbody>
    </table>
  );
}

function TypeRow({
  type,
  row,
  cellMax,
  measure,
}: {
  type: EngagementRowType;
  row: Record<Band, number>;
  cellMax: number;
  measure: EngagementMeasure;
}) {
  return (
    <tr>
      <td className="py-1 pr-3 text-agsi-navy">
        {ENGAGEMENT_TYPE_LABEL[type]}
      </td>
      {BAND_ORDER.map((b) => (
        <td key={b} className="p-1 text-center">
          <HeatCell value={row[b]} max={cellMax} band={b} measure={measure} />
        </td>
      ))}
    </tr>
  );
}

/**
 * Sequential single-ramp green cell. Intensity = value / cellMax.
 * Untouched (value 0) renders neutral (very pale grey) so an empty
 * cell doesn't scream "hot" or "cold" — it just means there's no
 * data there.
 */
function HeatCell({
  value,
  max,
  band,
  measure,
}: {
  value: number;
  max: number;
  band: Band;
  measure: EngagementMeasure;
}) {
  if (value === 0) {
    return (
      <span className="block rounded bg-agsi-offWhite py-1 text-xxs text-agsi-midGray">
        0
      </span>
    );
  }
  // Normalise against the grid max. Floor at 0.15 so even a "1" is
  // visible; ceiling at 1.0 for the darkest cell.
  const t = max > 0 ? Math.max(0.15, value / max) : 0;
  // Pale (rgb(220,242,231)) → deep (rgb(10,102,60)) — linear blend.
  const r = Math.round(220 + (10 - 220) * t);
  const g = Math.round(242 + (102 - 242) * t);
  const b = Math.round(231 + (60 - 231) * t);
  const textLight = t > 0.55;
  const measureSuffix = measure === 'companies' ? 'company' : 'event';
  return (
    <span
      className="block rounded py-1 text-xxs font-semibold tabular-nums"
      style={{
        backgroundColor: `rgb(${r}, ${g}, ${b})`,
        color: textLight ? '#ffffff' : '#0a3320',
      }}
      title={`${value.toLocaleString()} ${measureSuffix}${value === 1 ? '' : 's'} · ${band}`}
    >
      {value.toLocaleString()}
    </span>
  );
}

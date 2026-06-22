'use client';

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { AGSI } from '@/lib/design/colors';

export type TrendPoint = {
  snapshot_date: string;
  pre_construction_aed: number;
  under_construction_aed: number;
  rebar_tonnes: number;
};

export type PricePoint = {
  effective_month: string; // YYYY-MM
  price_aed_per_tonne: number;
};

export function TrendCharts({
  trend,
  prices,
}: {
  trend: TrendPoint[];
  prices: PricePoint[];
}) {
  const hasTrend = trend.length >= 2;
  const hasPrices = prices.length >= 2;

  if (!hasTrend && !hasPrices) {
    return null;
  }

  return (
    <div className="space-y-4">
      {hasTrend && (
        <Card>
          <CardHeader>
            <CardTitle>Pipeline trend</CardTitle>
            <CardDescription>
              Across all snapshot dates: pre-construction value (concept / design /
              tender), value currently under construction, and estimated rebar
              consumption (MT) in the active window.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <PipelineChart points={trend} />
            <p className="mt-2 text-xs2 italic text-agsi-darkGray">
              Data note: BNC began publishing values for pre-construction
              projects (concept / design / tender) from the 2026-06-05 export
              onward. Earlier snapshots show $0 for those stages because
              source values weren&apos;t reported, not because the pipeline
              was empty.
            </p>
          </CardContent>
        </Card>
      )}

      {hasPrices && (
        <Card>
          <CardHeader>
            <CardTitle>Rebar price history</CardTitle>
            <CardDescription>
              Local rebar price per tonne in AED, entered monthly via Admin → Rebar
              prices. Each market snapshot uses the price effective at its file date.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <PriceChart points={prices} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function PipelineChart({ points }: { points: TrendPoint[] }) {
  const aedDomain = paddedDomain(
    points.flatMap((p) => [p.pre_construction_aed, p.under_construction_aed]),
  );
  const tonnesDomain = paddedDomain(points.map((p) => p.rebar_tonnes));

  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={points} margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
          <CartesianGrid stroke={AGSI.lightGray} strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="snapshot_date"
            tickFormatter={fmtMonthYear}
            tick={{ fontSize: 11, fill: AGSI.darkGray }}
            stroke={AGSI.midGray}
          />
          <YAxis
            yAxisId="aed"
            orientation="left"
            domain={aedDomain}
            allowDecimals={false}
            tick={{ fontSize: 11, fill: AGSI.darkGray }}
            stroke={AGSI.midGray}
            tickFormatter={fmtAedAxis}
            label={{
              value: 'AED (left)',
              angle: -90,
              position: 'insideLeft',
              style: { fontSize: 11, fill: AGSI.darkGray },
            }}
          />
          <YAxis
            yAxisId="tonnes"
            orientation="right"
            domain={tonnesDomain}
            allowDecimals={false}
            tick={{ fontSize: 11, fill: AGSI.darkGray }}
            stroke={AGSI.midGray}
            tickFormatter={fmtTonnesAxis}
            label={{
              value: 'MT (right)',
              angle: 90,
              position: 'insideRight',
              style: { fontSize: 11, fill: AGSI.darkGray },
            }}
          />
          <Tooltip
            contentStyle={{
              fontSize: '11px',
              borderRadius: '6px',
              border: `1px solid ${AGSI.lightGray}`,
            }}
            formatter={(value, name) => {
              const v = Number(value);
              const series = String(name);
              if (series === 'rebar_tonnes') {
                return [
                  `${new Intl.NumberFormat().format(Math.round(v))} MT`,
                  'Rebar (in window)',
                ];
              }
              const aed = fmtAedFull(v);
              if (series === 'pre_construction_aed') return [aed, 'Pre-construction'];
              if (series === 'under_construction_aed') return [aed, 'Under construction'];
              return [aed, series];
            }}
            labelFormatter={(label) => `Snapshot: ${fmtMonthYear(String(label ?? ''))}`}
          />
          <Line
            yAxisId="aed"
            type="monotone"
            dataKey="pre_construction_aed"
            name="pre_construction_aed"
            stroke={AGSI.accent}
            strokeWidth={2}
            dot={{ r: 3 }}
          />
          <Line
            yAxisId="aed"
            type="monotone"
            dataKey="under_construction_aed"
            name="under_construction_aed"
            stroke={AGSI.navy}
            strokeWidth={2}
            dot={{ r: 3 }}
          />
          <Line
            yAxisId="tonnes"
            type="monotone"
            dataKey="rebar_tonnes"
            name="rebar_tonnes"
            stroke={AGSI.green}
            strokeWidth={2}
            dot={{ r: 3 }}
          />
        </LineChart>
      </ResponsiveContainer>
      <div className="mt-2 flex flex-wrap items-center gap-3 text-xs2 text-agsi-darkGray">
        <Legend color={AGSI.accent} label="Pre-construction value (AED)" />
        <Legend color={AGSI.navy} label="Under-construction value (AED)" />
        <Legend color={AGSI.green} label="Rebar in active window (MT)" />
      </div>
    </div>
  );
}

function PriceChart({ points }: { points: PricePoint[] }) {
  const priceDomain = paddedDomain(points.map((p) => p.price_aed_per_tonne));

  return (
    <div className="h-56 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={points} margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
          <CartesianGrid stroke={AGSI.lightGray} strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="effective_month"
            tickFormatter={fmtMonthYear}
            tick={{ fontSize: 11, fill: AGSI.darkGray }}
            stroke={AGSI.midGray}
          />
          <YAxis
            domain={priceDomain}
            allowDecimals={false}
            tick={{ fontSize: 11, fill: AGSI.darkGray }}
            stroke={AGSI.midGray}
            tickFormatter={(v: number) => new Intl.NumberFormat().format(v)}
            label={{
              value: 'AED / tonne',
              angle: -90,
              position: 'insideLeft',
              style: { fontSize: 11, fill: AGSI.darkGray },
            }}
          />
          <Tooltip
            contentStyle={{
              fontSize: '11px',
              borderRadius: '6px',
              border: `1px solid ${AGSI.lightGray}`,
            }}
            formatter={(value) => [
              `${new Intl.NumberFormat().format(Number(value))} AED/t`,
              'Price',
            ]}
            labelFormatter={(label) => `Month: ${fmtMonthYear(String(label ?? ''))}`}
          />
          <Line
            type="monotone"
            dataKey="price_aed_per_tonne"
            stroke={AGSI.gold}
            strokeWidth={2}
            dot={{ r: 3 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1">
      <span
        className="inline-block h-2 w-4 rounded"
        style={{ backgroundColor: color }}
        aria-hidden
      />
      {label}
    </span>
  );
}

/**
 * X-axis tick formatter. Accepts YYYY-MM or YYYY-MM-DD and returns
 * "Jan'26" (mixed-case 3-letter month + apostrophe + 2-digit year).
 * Falls through to the original string when the input doesn't parse.
 */
function fmtMonthYear(s: string): string {
  const m = s.match(/^(\d{4})-(\d{2})/);
  if (!m) return s;
  const yyyy = m[1];
  const mm = m[2];
  const date = new Date(`${yyyy}-${mm}-01T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return s;
  const month = date.toLocaleString('en-US', {
    month: 'short',
    timeZone: 'UTC',
  });
  return `${month}'${yyyy.slice(2)}`;
}

/**
 * Auto-scaled Y-axis domain that pads ±10% around the data so small
 * fluctuations are visible without losing context. Falls back to
 * [0, 1] for empty data. Zero / negative values are filtered when
 * computing min so a sparsely populated series doesn't collapse to 0.
 */
function paddedDomain(values: number[]): [number, number] {
  const positives = values.filter((v) => Number.isFinite(v) && v > 0);
  if (positives.length === 0) return [0, 1];
  const min = Math.min(...positives);
  const max = Math.max(...positives);
  return [min * 0.9, max * 1.1];
}

function fmtAedAxis(v: number): string {
  if (v >= 1_000_000_000) return `${(v / 1_000_000_000).toFixed(1)}B`;
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(0)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(0)}K`;
  return v.toFixed(0);
}

function fmtAedFull(v: number): string {
  if (v >= 1_000_000_000) return `${(v / 1_000_000_000).toFixed(2)}B AED`;
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M AED`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(0)}K AED`;
  return `${v.toFixed(0)} AED`;
}

function fmtTonnesAxis(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(0)}K`;
  return v.toFixed(0);
}

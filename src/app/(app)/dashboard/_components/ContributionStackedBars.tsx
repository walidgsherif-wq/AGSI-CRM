'use client';

import { useMemo } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { AGSI, CATEGORICAL_SERIES } from '@/lib/design/colors';
import type { CoverageRow } from '@/types/coverage';

const PCT = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });

/**
 * View A — Contribution by segment.
 *
 * One horizontal stacked bar per company type. Bar length = that type's
 * overall coverage % of universe (0–100%). The filled portion is split
 * into member-coloured segments by their share_pct; the remainder is
 * an explicit "gap" segment in lightGray that completes the 0–100%
 * track so short bars read as gaps and a single dominant colour reads
 * as concentration.
 *
 * Member colours come from CATEGORICAL_SERIES and stay stable across
 * types — the same colour for a given member on every bar.
 */
export function ContributionStackedBars({ data }: { data: CoverageRow[] }) {
  // Stable member ordering across the dataset — by total contribution
  // across all types. Index into CATEGORICAL_SERIES gives each member
  // a fixed colour. Members not assigned a category colour wrap with
  // modulo (rare — there are 8 categorical colours, BD teams smaller
  // than that).
  const { memberOrder, memberColour, memberName } = useMemo(() => {
    const totals = new Map<string, number>();
    const names = new Map<string, string>();
    for (const r of data) {
      for (const m of r.by_member) {
        totals.set(m.member_id, (totals.get(m.member_id) ?? 0) + m.count);
        names.set(m.member_id, m.full_name);
      }
    }
    const order = Array.from(totals.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([id]) => id);
    const colour = new Map<string, string>();
    order.forEach((id, i) =>
      colour.set(id, CATEGORICAL_SERIES[i % CATEGORICAL_SERIES.length]),
    );
    return { memberOrder: order, memberColour: colour, memberName: names };
  }, [data]);

  // Recharts wants one row per category (here: one per type), with a
  // numeric key per stacked segment. We emit one key per member +
  // a "gap" key so the bar fills the 0–100% track.
  const chartData = useMemo(() => {
    return data.map((row) => {
      const base: Record<string, string | number> = { label: row.label };
      let placed = 0;
      for (const id of memberOrder) {
        const m = row.by_member.find((x) => x.member_id === id);
        const v = m ? m.share_pct : 0;
        base[id] = v;
        placed += v;
      }
      base.__gap__ = Math.max(0, 100 - placed);
      base.__coverage__ = row.coverage_pct;
      return base;
    });
  }, [data, memberOrder]);

  const hasData = data.some((r) => r.numerator > 0);

  return (
    <div className="space-y-3">
      <div className="h-72 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={chartData}
            layout="vertical"
            margin={{ top: 8, right: 30, bottom: 8, left: 110 }}
          >
            <CartesianGrid
              horizontal={false}
              stroke={AGSI.lightGray}
              strokeDasharray="2 3"
            />
            <XAxis
              type="number"
              domain={[0, 100]}
              ticks={[0, 25, 50, 75, 100]}
              tickFormatter={(v) => `${v}%`}
              tick={{ fontSize: 10, fill: AGSI.darkGray }}
              axisLine={{ stroke: AGSI.midGray }}
            />
            <YAxis
              type="category"
              dataKey="label"
              tick={{ fontSize: 11, fill: AGSI.darkGray }}
              axisLine={{ stroke: AGSI.midGray }}
              tickLine={false}
              width={110}
            />
            <Tooltip
              cursor={{ fill: 'rgba(0,0,0,0.03)' }}
              contentStyle={{
                fontSize: '11px',
                borderRadius: '6px',
                border: `1px solid ${AGSI.lightGray}`,
              }}
              formatter={(value, name) => {
                if (name === '__gap__') {
                  return [`${PCT.format(Number(value))}% uncovered`, 'Gap'];
                }
                const id = String(name);
                const display = memberName.get(id) ?? id;
                const r = data.find((row) =>
                  row.by_member.find((m) => m.member_id === id),
                );
                const m = r?.by_member.find((x) => x.member_id === id);
                const count = m?.count ?? 0;
                return [
                  `${count} (${PCT.format(Number(value))}%)`,
                  display,
                ];
              }}
              labelFormatter={(label) => String(label)}
            />
            {memberOrder.map((id) => (
              <Bar
                key={id}
                dataKey={id}
                stackId="coverage"
                fill={memberColour.get(id)}
                isAnimationActive={false}
              />
            ))}
            <Bar dataKey="__gap__" stackId="coverage" isAnimationActive={false}>
              {chartData.map((_, idx) => (
                <Cell key={idx} fill={AGSI.lightGray} fillOpacity={0.6} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Legend — one chip per member + a coverage % per type next to */}
      {/* its label. Sized small so it tucks under the chart. */}
      {hasData && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-agsi-darkGray">
          <span className="font-medium uppercase tracking-wider">
            Members
          </span>
          {memberOrder.map((id) => (
            <span key={id} className="inline-flex items-center gap-1.5">
              <span
                aria-hidden
                className="h-2.5 w-2.5 rounded-sm"
                style={{ backgroundColor: memberColour.get(id) }}
              />
              {memberName.get(id) ?? id}
            </span>
          ))}
          <span className="inline-flex items-center gap-1.5">
            <span
              aria-hidden
              className="h-2.5 w-2.5 rounded-sm"
              style={{ backgroundColor: AGSI.lightGray }}
            />
            Uncovered gap
          </span>
        </div>
      )}

      {/* Per-type overall % strip — quick read of which segments are */}
      {/* underwater without hovering. */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-agsi-darkGray sm:grid-cols-4">
        {data.map((r) => (
          <span key={r.type}>
            <strong className="text-agsi-navy">{r.label}</strong> ·{' '}
            {PCT.format(r.coverage_pct)}%
            <span className="text-agsi-midGray"> ({r.numerator}/{r.denominator})</span>
          </span>
        ))}
      </div>
    </div>
  );
}

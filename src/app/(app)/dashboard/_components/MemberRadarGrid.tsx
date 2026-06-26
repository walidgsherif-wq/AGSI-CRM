'use client';

import { useMemo } from 'react';
import {
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
} from 'recharts';
import { AGSI, CATEGORICAL_SERIES } from '@/lib/design/colors';
import type { CoverageRow } from '@/types/coverage';

const PCT = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });

type MemberRadarRow = {
  label: string;
  pct: number; // member count / type denominator * 100
  count: number;
  denominator: number;
};

type PerMember = {
  member_id: string;
  full_name: string;
  total_count: number;
  total_denominator: number;
  overall_pct: number;
  rows: MemberRadarRow[];
};

/**
 * View B — By member.
 *
 * One small radar per BD member that owns at least one stakeholder.
 * Each spoke = that member's claimed count of that type ÷ that type's
 * universe count (band-filtered). Header per radar = member name + their
 * overall coverage % (their total claimed across all types ÷ the
 * combined universe).
 *
 * Members with zero claims across every spoke are filtered out — keeps
 * the grid focused on actual contributors.
 *
 * Each member gets a stable colour from CATEGORICAL_SERIES, matching
 * the same member's colour in the stacked-bars view (View A).
 */
export function MemberRadarGrid({ data }: { data: CoverageRow[] }) {
  const members = useMemo<PerMember[]>(() => {
    const totalDenominator = data.reduce((s, r) => s + r.denominator, 0);
    const totalsById = new Map<string, { name: string; total: number }>();
    const rowsById = new Map<string, MemberRadarRow[]>();

    for (const r of data) {
      for (const m of r.by_member) {
        const cur = totalsById.get(m.member_id);
        if (cur) cur.total += m.count;
        else
          totalsById.set(m.member_id, {
            name: m.full_name,
            total: m.count,
          });
      }
    }

    // For each member, build a row per spoke (zero-fill empties so the
    // radar polygon visits every angle and shape is comparable).
    for (const [id] of totalsById) {
      const rows = data.map<MemberRadarRow>((r) => {
        const m = r.by_member.find((x) => x.member_id === id);
        const count = m?.count ?? 0;
        return {
          label: r.label,
          count,
          denominator: r.denominator,
          pct: r.denominator === 0 ? 0 : (count / r.denominator) * 100,
        };
      });
      rowsById.set(id, rows);
    }

    return Array.from(totalsById.entries())
      .sort((a, b) => b[1].total - a[1].total)
      .map(([id, t]) => ({
        member_id: id,
        full_name: t.name,
        total_count: t.total,
        total_denominator: totalDenominator,
        overall_pct:
          totalDenominator === 0 ? 0 : (t.total / totalDenominator) * 100,
        rows: rowsById.get(id) ?? [],
      }));
  }, [data]);

  if (members.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-agsi-lightGray p-6 text-center text-xs text-agsi-darkGray">
        No claimed stakeholders in this scope — by-member view will populate
        once the team starts claiming companies.
      </p>
    );
  }

  // Same colour palette + order as ContributionStackedBars uses, so the
  // member-to-colour mapping stays consistent across the two views.
  const colourById = new Map<string, string>();
  members.forEach((m, i) =>
    colourById.set(
      m.member_id,
      CATEGORICAL_SERIES[i % CATEGORICAL_SERIES.length],
    ),
  );

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {members.map((m) => {
        const colour = colourById.get(m.member_id) ?? AGSI.accent;
        return (
          <div
            key={m.member_id}
            className="rounded-xl border border-agsi-lightGray bg-white p-3"
          >
            <div className="flex items-start justify-between gap-2">
              <p className="text-sm font-semibold text-agsi-navy">
                {m.full_name}
              </p>
              <span className="text-xs font-medium tabular-nums text-agsi-darkGray">
                {PCT.format(m.overall_pct)}%
                <span className="ml-1 text-agsi-midGray">
                  ({m.total_count}/{m.total_denominator})
                </span>
              </span>
            </div>
            <div className="mt-2 h-52 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <RadarChart data={m.rows} outerRadius="72%">
                  <PolarGrid stroke={AGSI.lightGray} />
                  <PolarAngleAxis
                    dataKey="label"
                    tick={{ fontSize: 9, fill: AGSI.darkGray }}
                  />
                  <PolarRadiusAxis
                    domain={[0, 100]}
                    tickCount={5}
                    tickFormatter={(v) => `${v}%`}
                    tick={{ fontSize: 9, fill: AGSI.midGray }}
                    axisLine={false}
                  />
                  <Tooltip
                    contentStyle={{
                      fontSize: '11px',
                      borderRadius: '6px',
                      border: `1px solid ${AGSI.lightGray}`,
                    }}
                    formatter={(_value, _name, item) => {
                      const row = item.payload as MemberRadarRow;
                      return [
                        `${row.count} of ${row.denominator} (${PCT.format(row.pct)}%)`,
                        m.full_name,
                      ];
                    }}
                    labelFormatter={(label) => String(label)}
                  />
                  <Radar
                    name={m.full_name}
                    dataKey="pct"
                    stroke={colour}
                    fill={colour}
                    fillOpacity={0.3}
                    strokeWidth={2}
                    isAnimationActive={false}
                  />
                </RadarChart>
              </ResponsiveContainer>
            </div>
          </div>
        );
      })}
    </div>
  );
}

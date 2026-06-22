'use client';

import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { AGSI } from '@/lib/brand-colors';

type TrendPoint = {
  snapshot_date: string;
  active_score: number;
  lifetime_score: number;
};

export function EcosystemTrendChart({ trend }: { trend: TrendPoint[] }) {
  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={trend} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="active-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={AGSI.green} stopOpacity={0.35} />
              <stop offset="100%" stopColor={AGSI.green} stopOpacity={0.04} />
            </linearGradient>
            <linearGradient id="lifetime-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={AGSI.navy} stopOpacity={0.18} />
              <stop offset="100%" stopColor={AGSI.navy} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke={AGSI.lightGray} strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="snapshot_date"
            tickFormatter={(v: string) => v.slice(5)}
            tick={{ fontSize: 11, fill: AGSI.darkGray }}
            stroke={AGSI.midGray}
          />
          <YAxis
            tick={{ fontSize: 11, fill: AGSI.darkGray }}
            stroke={AGSI.midGray}
            tickFormatter={(v: number) =>
              new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(v)
            }
          />
          <Tooltip
            contentStyle={{
              fontSize: '12px',
              borderRadius: '6px',
              border: `1px solid ${AGSI.lightGray}`,
            }}
            formatter={(value, name) => [
              new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(Number(value)),
              String(name) === 'lifetime_score' ? 'Lifetime' : 'Active (90d)',
            ]}
            labelFormatter={(label) => `Snapshot: ${String(label ?? '')}`}
          />
          <Legend
            verticalAlign="top"
            height={28}
            wrapperStyle={{ fontSize: '11px' }}
            formatter={(value) =>
              String(value) === 'lifetime_score' ? 'Lifetime' : 'Active (90d)'
            }
          />
          <Area
            type="monotone"
            dataKey="lifetime_score"
            stroke={AGSI.navy}
            fill="url(#lifetime-fill)"
            strokeWidth={1.5}
          />
          <Area
            type="monotone"
            dataKey="active_score"
            stroke={AGSI.green}
            fill="url(#active-fill)"
            strokeWidth={2}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

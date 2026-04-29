'use client';

import {
  Area,
  AreaChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

type TrendPoint = {
  snapshot_date: string;
  active_score: number;
  lifetime_score: number;
};

export function EcosystemTrendSpark({ trend }: { trend: TrendPoint[] }) {
  return (
    <div className="h-20 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={trend} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="ecosystem-spark-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#2E7D52" stopOpacity={0.4} />
              <stop offset="100%" stopColor="#2E7D52" stopOpacity={0.05} />
            </linearGradient>
          </defs>
          <XAxis dataKey="snapshot_date" hide />
          <YAxis hide domain={['dataMin', 'dataMax']} />
          <Tooltip
            contentStyle={{
              fontSize: '11px',
              borderRadius: '6px',
              border: '1px solid #E8EDF4',
            }}
            formatter={(value) => [fmt(Number(value)), 'Active']}
            labelFormatter={(label) => String(label ?? '')}
          />
          <Area
            type="monotone"
            dataKey="active_score"
            stroke="#2E7D52"
            fill="url(#ecosystem-spark-fill)"
            strokeWidth={1.5}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function fmt(n: number): string {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(n);
}

'use client';

import * as React from 'react';
import {
  Area,
  AreaChart,
  ResponsiveContainer,
  YAxis,
} from 'recharts';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { AGSI, STATUS_COLOUR } from '@/lib/design/colors';

type Direction = 'up' | 'down' | 'neutral';

export interface StatCardProps {
  label: string;
  /** Pre-formatted value string — let the caller decide locale / units. */
  value: string;
  /** Optional secondary line below the value. */
  sublabel?: string;
  /**
   * Optional period-over-period delta string. Coloured by
   * `deltaDirection`: `up` → green, `down` → red, `neutral` → gray.
   * Caller decides whether `up` is good or bad (some metrics invert).
   */
  delta?: string;
  deltaDirection?: Direction;
  /**
   * Optional tiny sparkline. Array of numbers; the primitive only
   * draws the shape, no axis / tooltip. Pass `undefined` to skip.
   */
  trend?: number[];
  className?: string;
}

const DIRECTION_COLOUR: Record<Direction, string> = {
  up: STATUS_COLOUR.green,
  down: STATUS_COLOUR.red,
  neutral: AGSI.darkGray,
};

export function StatCard({
  label,
  value,
  sublabel,
  delta,
  deltaDirection = 'neutral',
  trend,
  className,
}: StatCardProps) {
  const trendSeries =
    trend && trend.length >= 2 ? trend.map((v, i) => ({ x: i, y: v })) : null;

  return (
    <Card className={cn('flex flex-col justify-between gap-3 p-4', className)}>
      <div>
        <p className="text-xs uppercase tracking-wider text-agsi-darkGray">{label}</p>
        <p className="mt-1 text-2xl font-semibold tabular-nums text-agsi-navy">{value}</p>
        {(sublabel || delta) && (
          <div className="mt-1 flex flex-wrap items-baseline gap-2">
            {delta && (
              <span
                className="text-xs2 font-medium tabular-nums"
                style={{ color: DIRECTION_COLOUR[deltaDirection] }}
              >
                {deltaDirection === 'up' ? '↑ ' : deltaDirection === 'down' ? '↓ ' : ''}
                {delta}
              </span>
            )}
            {sublabel && <span className="text-xs2 text-agsi-darkGray">{sublabel}</span>}
          </div>
        )}
      </div>

      {trendSeries && (
        <div className="-mx-1 h-9">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={trendSeries} margin={{ top: 2, right: 2, bottom: 0, left: 2 }}>
              <defs>
                <linearGradient id="statcard-spark" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={AGSI.accent} stopOpacity={0.25} />
                  <stop offset="100%" stopColor={AGSI.accent} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <YAxis hide domain={['dataMin', 'dataMax']} />
              <Area
                type="monotone"
                dataKey="y"
                stroke={AGSI.accent}
                strokeWidth={1.5}
                fill="url(#statcard-spark)"
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </Card>
  );
}

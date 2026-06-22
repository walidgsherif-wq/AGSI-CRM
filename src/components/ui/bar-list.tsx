import * as React from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import { cn } from '@/lib/utils';
import { AGSI } from '@/lib/design/colors';

export interface BarListItem {
  name: string;
  value: number;
  /** Optional secondary value rendered after the primary one (e.g. AED total). */
  secondary?: string;
  /** Optional row link. Becomes a keyboard-accessible <Link>. */
  href?: string;
}

export interface BarListProps {
  items: BarListItem[];
  /** Format the displayed primary value. Default: locale integer. */
  valueFormatter?: (n: number) => string;
  /** Bar fill colour. Default: AGSI accent. */
  barColour?: string;
  /** Max bar height multiplier for visual scale. Default: 1.0 (proportional). */
  className?: string;
}

const defaultFmt = (n: number) =>
  new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(n);

export function BarList({
  items,
  valueFormatter = defaultFmt,
  barColour = AGSI.accent,
  className,
}: BarListProps) {
  if (items.length === 0) {
    return <p className={cn('text-sm text-agsi-darkGray', className)}>No data.</p>;
  }

  const sorted = [...items].sort((a, b) => b.value - a.value);
  const max = sorted[0]?.value ?? 0;

  return (
    <ol className={cn('space-y-1 text-sm', className)}>
      {sorted.map((item, i) => {
        const pct = max > 0 ? Math.max(2, (item.value / max) * 100) : 0;
        const inner = (
          <div className="relative flex items-center justify-between gap-3 px-2 py-1.5">
            <div
              aria-hidden
              className="absolute inset-y-0 left-0 rounded"
              style={{
                width: `${pct}%`,
                backgroundColor: barColour,
                opacity: 0.18,
              }}
            />
            <span className="relative flex min-w-0 items-center gap-2">
              <span className="text-xs2 text-agsi-darkGray tabular-nums">{i + 1}.</span>
              <span className="truncate text-agsi-navy" title={item.name}>
                {item.name}
              </span>
            </span>
            <span className="relative ml-2 flex items-center gap-2 tabular-nums">
              <span className="font-semibold text-agsi-navy">
                {valueFormatter(item.value)}
              </span>
              {item.secondary && (
                <span className="text-xs2 text-agsi-darkGray">{item.secondary}</span>
              )}
            </span>
          </div>
        );

        const key = `${item.name}-${i}`;
        if (item.href) {
          return (
            <li key={key}>
              <Link
                href={item.href as Route}
                className="block rounded transition-colors hover:bg-agsi-lightGray/40 focus-visible:bg-agsi-lightGray/40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-agsi-accent"
              >
                {inner}
              </Link>
            </li>
          );
        }
        return <li key={key}>{inner}</li>;
      })}
    </ol>
  );
}

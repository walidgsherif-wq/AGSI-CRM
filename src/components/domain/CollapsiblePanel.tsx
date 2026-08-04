'use client';

import { useEffect, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

/**
 * Dashboard-panel shell: header always visible + collapsible body.
 * Default collapsed; state persists per user in localStorage keyed
 * by `agsi:panel-collapsed:<userId>:<panelId>` so a shared browser
 * doesn't leak one teammate's layout into another's.
 *
 * The `pulse` slot is the always-visible summary. Panels compute it
 * from their own live state (bus-refetched action queue, task
 * counts, etc.) so the pulse stays accurate whether the body is
 * open or closed — persistence never costs awareness.
 *
 * `urgent` drives a red-accent left border on the collapsed
 * header — an overdue-loaded panel stays visibly loud even when
 * collapsed, while calm panels tuck away quietly.
 *
 * Smooth expand/collapse via the `grid-template-rows: 0fr → 1fr`
 * technique — no per-panel measured heights, works across variable
 * body content.
 */
export function CollapsiblePanel({
  panelId,
  userId,
  title,
  pulse,
  urgent = false,
  defaultExpanded = false,
  children,
}: {
  panelId: string;
  userId: string;
  title: string;
  pulse?: React.ReactNode;
  urgent?: boolean;
  defaultExpanded?: boolean;
  children: React.ReactNode;
}) {
  const storageKey = `agsi:panel-collapsed:${userId}:${panelId}`;
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (raw === '1') setExpanded(true);
      else if (raw === '0') setExpanded(false);
    } catch {
      // localStorage disabled / private mode — keep in-memory default.
    }
    setHydrated(true);
  }, [storageKey]);

  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(storageKey, expanded ? '1' : '0');
    } catch {
      // Ignore quota / private-mode errors — state stays in memory.
    }
  }, [hydrated, expanded, storageKey]);

  return (
    <Card
      className={cn(
        'overflow-hidden transition-shadow',
        urgent && !expanded && 'border-l-4 border-l-rag-red',
      )}
    >
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        aria-controls={`panel-body-${panelId}`}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-agsi-offWhite/40"
      >
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="text-base font-semibold text-agsi-navy">
            {title}
          </span>
          {pulse && (
            <span className="min-w-0 text-xs text-agsi-darkGray">{pulse}</span>
          )}
        </div>
        <ChevronDown
          aria-hidden
          className={cn(
            'h-4 w-4 shrink-0 text-agsi-darkGray transition-transform duration-200',
            expanded && 'rotate-180',
          )}
        />
      </button>
      <div
        id={`panel-body-${panelId}`}
        className={cn(
          'grid transition-[grid-template-rows] duration-200 ease-out',
          expanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
        )}
        aria-hidden={!expanded}
      >
        <div className="overflow-hidden">
          <div className="border-t border-agsi-lightGray/60">{children}</div>
        </div>
      </div>
    </Card>
  );
}

/**
 * Standardised summary-pulse text. "3 overdue · 12 open" with the
 * overdue segment red when > 0; a calm phrase when everything is
 * zero. Handed to CollapsiblePanel via the `pulse` prop.
 */
export function CountPulse({
  overdue = 0,
  open = 0,
  calmText,
}: {
  overdue?: number;
  open?: number;
  calmText: string;
}) {
  if (overdue === 0 && open === 0) {
    return <span className="italic text-agsi-darkGray">{calmText}</span>;
  }
  return (
    <>
      {overdue > 0 && (
        <span className="font-medium text-rag-red">{overdue} overdue</span>
      )}
      {overdue > 0 && open > 0 && <span className="text-agsi-midGray"> · </span>}
      {open > 0 && <span className="text-agsi-navy">{open} open</span>}
    </>
  );
}

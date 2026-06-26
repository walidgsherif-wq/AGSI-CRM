'use client';

import { useDeferredValue, useState } from 'react';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Avatar } from '@/components/ui/avatar';
import { LevelBadge } from '@/components/domain/LevelBadge';
import { LevelChangeDialog, adjacentTargets } from '@/components/domain/LevelChangeDialog';
import { PendingLevelUpBadge } from '@/components/domain/PendingLevelUpBadge';
import { LEVELS, type Level, type Role } from '@/types/domain';
import { COMPANY_TYPE_LABEL } from '@/lib/zod/company';
import { cn } from '@/lib/utils';

export type EngagementBucket = 'hot' | 'warm' | 'cooling' | 'cold';

export type CardData = {
  id: string;
  canonical_name: string;
  company_type: keyof typeof COMPANY_TYPE_LABEL;
  current_level: Level;
  city: string | null;
  is_key_stakeholder: boolean;
  has_active_projects: boolean;
  owner_id: string | null;
  owner_full_name: string | null;
  /** Most recent pending level_change_request for this company, if any. */
  pending: {
    request_id: string;
    from_level: Level;
    to_level: Level;
  } | null;
  engagement_bucket: EngagementBucket;
  engagement_days_since: number | null;
  /** Owned but missing emirate (location_id) or any live contact w/ email. */
  needs_details: boolean;
  /** Has emirate AND at least one live contact with email — gate for L2+. */
  is_progress_ready: boolean;
};

const GLOW_CLASSES: Record<EngagementBucket, string> = {
  hot: 'border-rag-green/40 bg-rag-green/5 ring-1 ring-rag-green/30 shadow-[0_0_12px_rgba(46,125,82,0.25)]',
  warm: 'border-agsi-accent/30 bg-agsi-accent/5 ring-1 ring-agsi-accent/20',
  cooling: 'border-rag-amber/40 bg-rag-amber/5',
  cold: 'border-rag-red/50 bg-white ring-1 ring-rag-red/15',
};

const CHIP_CLASSES: Record<EngagementBucket, string> = {
  hot: 'bg-rag-green text-white',
  warm: 'bg-agsi-accent text-white',
  cooling: 'bg-rag-amber text-white',
  cold: 'bg-rag-red text-white',
};

function engagementTooltip(c: CardData): string {
  return c.engagement_days_since === null
    ? 'No engagement on record'
    : `Last engagement ${c.engagement_days_since}d ago`;
}

function engagementBadgeLabel(c: CardData): string {
  return c.engagement_days_since === null ? 'Never' : `${c.engagement_days_since}d`;
}

const LEVEL_INDEX: Record<Level, number> = {
  L0: 0,
  L1: 1,
  L2: 2,
  L3: 3,
  L4: 4,
  L5: 5,
};

const LEVEL_DESCRIPTION: Record<Level, string> = {
  L0: 'Not yet engaged',
  L1: 'Identified',
  L2: 'In conversation',
  L3: 'Active relationship',
  L4: 'MOU signed',
  L5: 'Strategic partnership',
};

export function PipelineKanban({
  cards,
  userRole,
  userId,
}: {
  cards: CardData[];
  userRole: Role;
  userId: string;
}) {
  const [dragging, setDragging] = useState<{ cardId: string; from: Level } | null>(null);
  const [forced, setForced] = useState<{ card: CardData; toLevel: Level } | null>(null);
  // L0 (~thousands of "not yet engaged" companies) buries L1–L5 by
  // default and bloats render. Hide it unless the user opts in via the
  // toggle below. Simple local state — no broader filter system yet.
  const [showL0, setShowL0] = useState(false);
  // Live company-name search. Composes AND with the (server-side)
  // stakeholder-type filter, normalises whitespace + case, and reveals
  // L0 cards as soon as the query matches one — even though L0 is
  // hidden by default — otherwise the not-yet-engaged backlog is
  // unsearchable. useDeferredValue keeps typing snappy on a large card
  // set without an explicit debounce.
  const [searchQuery, setSearchQuery] = useState('');
  const deferredQuery = useDeferredValue(searchQuery);
  const normalizedQuery = deferredQuery.trim().toLowerCase().replace(/\s+/g, ' ');
  const searchActive = normalizedQuery.length > 0;

  // L0 count from the unfiltered card set — the toggle label always
  // reflects the full backlog, not the in-search hit count.
  const totalL0Count = cards.reduce(
    (n, c) => n + (c.current_level === 'L0' ? 1 : 0),
    0,
  );

  const visibleCards = searchActive
    ? cards.filter((c) =>
        c.canonical_name.toLowerCase().replace(/\s+/g, ' ').includes(normalizedQuery),
      )
    : cards;

  const grouped: Record<Level, CardData[]> = { L0: [], L1: [], L2: [], L3: [], L4: [], L5: [] };
  for (const c of visibleCards) grouped[c.current_level].push(c);

  // Reveal L0 if the user opted in OR a search is active with L0 hits.
  // Clearing the search reverts to the toggle state.
  const showL0Effective = showL0 || (searchActive && grouped.L0.length > 0);
  const visibleLevels = showL0Effective ? LEVELS : LEVELS.filter((l) => l !== 'L0');

  function canChange(card: CardData) {
    return userRole === 'admin' || card.owner_id === userId;
  }

  function isAdjacent(from: Level, to: Level) {
    return Math.abs(LEVEL_INDEX[from] - LEVEL_INDEX[to]) === 1;
  }

  function handleDrop(targetLevel: Level) {
    if (!dragging) return;
    if (dragging.from === targetLevel) {
      setDragging(null);
      return;
    }
    if (!isAdjacent(dragging.from, targetLevel)) {
      // Skip-level drops are silently ignored — user gets visual feedback
      // because adjacent columns highlight while non-adjacent don't.
      setDragging(null);
      return;
    }
    const card = cards.find((c) => c.id === dragging.cardId);
    if (!card) {
      setDragging(null);
      return;
    }
    if (!canChange(card)) {
      setDragging(null);
      return;
    }
    setForced({ card, toLevel: targetLevel });
    setDragging(null);
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search companies…"
          aria-label="Search companies by name"
          className="w-64 rounded border border-agsi-midGray bg-white px-3 py-1 text-xs text-agsi-navy placeholder:text-agsi-darkGray focus:border-agsi-navy focus:outline-none"
        />
        <button
          type="button"
          onClick={() => setShowL0((v) => !v)}
          aria-pressed={showL0}
          className={
            showL0
              ? 'rounded border border-agsi-navy bg-agsi-navy px-3 py-1 text-xs font-medium text-white'
              : 'rounded border border-agsi-midGray px-3 py-1 text-xs font-medium text-agsi-navy hover:bg-agsi-lightGray/40'
          }
        >
          {showL0 ? 'Hide' : 'Show'} not-yet-engaged · L0 · {totalL0Count.toLocaleString()}
        </button>
      </div>
      <div
        className={cn(
          'grid gap-3 sm:grid-cols-2 lg:grid-cols-3',
          showL0Effective ? 'xl:grid-cols-6' : 'xl:grid-cols-5',
        )}
      >
        {visibleLevels.map((level) => {
          const colCards = grouped[level];
          const isAdjacentTarget = dragging ? isAdjacent(dragging.from, level) : false;
          const isSourceCol = dragging?.from === level;
          return (
            <div
              key={level}
              onDragOver={(e) => {
                if (isAdjacentTarget) {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'move';
                }
              }}
              onDrop={(e) => {
                if (!isAdjacentTarget) return;
                e.preventDefault();
                handleDrop(level);
              }}
              className={cn(
                'flex min-h-[120px] flex-col rounded-lg p-1 transition-colors',
                isAdjacentTarget && 'bg-agsi-accent/10 ring-2 ring-agsi-accent/40',
                isSourceCol && 'opacity-60',
              )}
            >
              <div className="mb-2 flex items-center justify-between px-1">
                <div className="flex items-center gap-2">
                  <LevelBadge level={level} />
                  <span className="text-xs text-agsi-darkGray">{colCards.length}</span>
                </div>
              </div>
              <p className="mb-2 px-1 text-xs text-agsi-darkGray">{LEVEL_DESCRIPTION[level]}</p>
              <div className="space-y-2">
                {colCards.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-agsi-lightGray p-3 text-xs text-agsi-darkGray">
                    {dragging && isAdjacentTarget ? 'Drop here to move →' : 'No companies at this level.'}
                  </p>
                ) : (
                  colCards.map((c) => {
                    // Drag is always allowed for movers — the gate
                    // only bites when the target column is L2+ and
                    // the company is incomplete. Backward and
                    // L0 → L1 drags pass through. The dialog re-checks
                    // on submit so a stale-state card can't sneak past.
                    const draggable = canChange(c);
                    const upwardBlocked =
                      c.current_level >= 'L1' && !c.is_progress_ready;
                    return (
                      <div
                        key={c.id}
                        draggable={draggable}
                        onDragStart={(e) => {
                          if (!draggable) return;
                          e.dataTransfer.effectAllowed = 'move';
                          setDragging({ cardId: c.id, from: c.current_level });
                        }}
                        onDragEnd={() => setDragging(null)}
                        title={engagementTooltip(c)}
                        className={cn(
                          'rounded-lg border p-3 transition-shadow',
                          GLOW_CLASSES[c.engagement_bucket],
                          draggable && 'cursor-grab active:cursor-grabbing',
                          dragging?.cardId === c.id && 'opacity-50',
                        )}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <Link
                            href={`/companies/${c.id}`}
                            className="text-sm font-medium text-agsi-navy hover:underline"
                            // Suppress the browser's default link-drag behaviour so the
                            // card-drag handler wins.
                            draggable={false}
                          >
                            {c.canonical_name}
                          </Link>
                          <div className="flex shrink-0 items-center gap-1.5">
                            {c.is_key_stakeholder && <Badge variant="gold">Key</Badge>}
                            <span
                              aria-label={
                                c.engagement_days_since === null
                                  ? 'No engagement on record'
                                  : `${c.engagement_days_since} days since last engagement`
                              }
                              className={cn(
                                'inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-xxs font-semibold tabular-nums',
                                CHIP_CLASSES[c.engagement_bucket],
                              )}
                            >
                              {engagementBadgeLabel(c)}
                            </span>
                            <Avatar
                              name={c.owner_full_name}
                              size="xs"
                              title={`Owner: ${c.owner_full_name ?? 'Unassigned'}`}
                            />
                          </div>
                        </div>
                        <p className="mt-1 text-xs text-agsi-darkGray">
                          {COMPANY_TYPE_LABEL[c.company_type]}
                          {c.city && ` · ${c.city}`}
                        </p>
                        {c.pending && (
                          <div className="mt-2">
                            <PendingLevelUpBadge
                              request={c.pending}
                              viewerRole={userRole}
                              size="card"
                            />
                          </div>
                        )}
                        {c.needs_details && (
                          <Badge variant="amber" className="mt-2">
                            Needs details
                          </Badge>
                        )}
                        {canChange(c) && (
                          <div className="mt-2 flex items-center justify-between">
                            {upwardBlocked ? (
                              <span
                                title="Add the stakeholder's emirate and a contact with a work email before moving to L2 or beyond."
                                className="text-xs text-agsi-midGray"
                              >
                                {userRole === 'admin' ? 'Change level' : 'Request level change'}
                              </span>
                            ) : (
                              <button
                                type="button"
                                onClick={() => {
                                  const targets = adjacentTargets(c.current_level);
                                  setForced({ card: c, toLevel: targets[0] });
                                }}
                                className="text-xs text-agsi-accent hover:underline"
                              >
                                {userRole === 'admin' ? 'Change level →' : 'Request level change →'}
                              </button>
                            )}
                            <span className="text-xxs text-agsi-darkGray">
                              {upwardBlocked ? 'L2+ locked' : 'drag ↔'}
                            </span>
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          );
        })}
      </div>

      {forced && (
        <LevelChangeDialog
          companyId={forced.card.id}
          companyName={forced.card.canonical_name}
          currentLevel={forced.card.current_level}
          userRole={userRole}
          isOwner={forced.card.owner_id === userId}
          isProgressReady={forced.card.is_progress_ready}
          forcedToLevel={forced.toLevel}
          onClose={() => setForced(null)}
        />
      )}
    </>
  );
}

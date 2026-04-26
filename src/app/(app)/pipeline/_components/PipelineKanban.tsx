'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { LevelBadge } from '@/components/domain/LevelBadge';
import { LevelChangeDialog, adjacentTargets } from '@/components/domain/LevelChangeDialog';
import { LEVELS, type Level, type Role } from '@/types/domain';
import { COMPANY_TYPE_LABEL } from '@/lib/zod/company';
import { cn } from '@/lib/utils';

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
  pending_count: number;
};

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

  const grouped: Record<Level, CardData[]> = { L0: [], L1: [], L2: [], L3: [], L4: [], L5: [] };
  for (const c of cards) grouped[c.current_level].push(c);

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
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {LEVELS.map((level) => {
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
                    const draggable = canChange(c);
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
                        className={cn(
                          'rounded-lg border border-agsi-lightGray bg-white p-3 shadow-sm',
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
                          {c.is_key_stakeholder && (
                            <Badge variant="gold" className="shrink-0">
                              Key
                            </Badge>
                          )}
                        </div>
                        <p className="mt-1 text-xs text-agsi-darkGray">
                          {COMPANY_TYPE_LABEL[c.company_type]}
                          {c.city && ` · ${c.city}`}
                        </p>
                        <p className="mt-1 text-xs text-agsi-darkGray">
                          Owner: {c.owner_full_name ?? 'Unassigned'}
                        </p>
                        {c.pending_count > 0 && (
                          <Badge variant="amber" className="mt-2">
                            {c.pending_count} pending review
                          </Badge>
                        )}
                        {draggable && (
                          <div className="mt-2 flex items-center justify-between">
                            <button
                              type="button"
                              onClick={() => {
                                const targets = adjacentTargets(c.current_level);
                                // Pop dialog without forcedToLevel so user picks dropdown
                                setForced({ card: c, toLevel: targets[0] });
                              }}
                              className="text-xs text-agsi-accent hover:underline"
                            >
                              {userRole === 'admin' ? 'Change level →' : 'Request level change →'}
                            </button>
                            <span className="text-[10px] text-agsi-darkGray">drag ↔</span>
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
          forcedToLevel={forced.toLevel}
          onClose={() => setForced(null)}
        />
      )}
    </>
  );
}

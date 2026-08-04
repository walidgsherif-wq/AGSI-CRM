'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { setTaskStatus } from '@/server/actions/tasks';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

// 3-column board over the user's tasks. Mirrors PipelineKanban's
// HTML5-native DnD pattern (no library, no new schema) — see
// /pipeline/_components/PipelineKanban.tsx. Drops call the existing
// setTaskStatus(id, status) server action, no parallel mutation path.
//
// Column mapping uses existing task_status_t values:
//   To-do       = open
//   In Progress = in_progress
//   Done        = done
// 'cancelled' tasks are excluded from the board (it's still a valid
// status, just not relevant to the work-in-flight view).

export type TaskKanbanCard = {
  id: string;
  title: string;
  status: 'open' | 'in_progress' | 'done' | 'cancelled';
  due_date: string | null;
  company_id: string | null;
  company_name: string | null;
  owner_id: string;
  owner_full_name: string | null;
  has_reminders: boolean;
  assigned_by_id: string | null;
  assigned_by_name: string | null;
};

type BoardStatus = 'open' | 'in_progress' | 'done';

const COLUMNS: ReadonlyArray<{ key: BoardStatus; label: string; tone: string }> = [
  { key: 'open',        label: 'To-do',       tone: 'border-agsi-midGray' },
  { key: 'in_progress', label: 'In progress', tone: 'border-agsi-accent/50' },
  { key: 'done',        label: 'Done',        tone: 'border-rag-green/40' },
];

type ProvenanceFilter = 'all' | 'assigned_to_me' | 'created_by_me';

const FILTER_OPTIONS: ReadonlyArray<{ key: ProvenanceFilter; label: string }> = [
  { key: 'all',            label: 'All' },
  { key: 'assigned_to_me', label: 'Assigned to me by others' },
  { key: 'created_by_me',  label: 'Created by me' },
];

export function TaskKanban({
  cards,
  currentUserId,
}: {
  cards: TaskKanbanCard[];
  currentUserId: string;
}) {
  const router = useRouter();
  const [dragging, setDragging] = useState<{ cardId: string; from: BoardStatus } | null>(null);
  const [filter, setFilter] = useState<ProvenanceFilter>('all');
  const [, startTransition] = useTransition();

  // Provenance filter: who originated each task.
  //   assigned_to_me → I'm the owner AND someone else delegated to me
  //                   (FX-014b only stamps assigned_by_id when assigner
  //                    ≠ owner, so this is sufficient).
  //   created_by_me  → I'm the originator: either I own it and nobody
  //                   delegated, or I'm the one who delegated it.
  function passesFilter(c: TaskKanbanCard): boolean {
    if (filter === 'all') return true;
    if (filter === 'assigned_to_me') {
      return c.owner_id === currentUserId && c.assigned_by_id !== null;
    }
    // created_by_me
    return (
      (c.assigned_by_id === null && c.owner_id === currentUserId) ||
      c.assigned_by_id === currentUserId
    );
  }

  // Pre-group by status. Cards with status 'cancelled' are not bucketed
  // into any column and simply don't render — drag from cancelled into
  // the board isn't a flow we expose here.
  const grouped: Record<BoardStatus, TaskKanbanCard[]> = { open: [], in_progress: [], done: [] };
  for (const c of cards) {
    if (c.status === 'cancelled') continue;
    if (!passesFilter(c)) continue;
    grouped[c.status].push(c);
  }

  function handleDrop(target: BoardStatus) {
    if (!dragging) return;
    if (dragging.from === target) {
      setDragging(null);
      return;
    }
    const cardId = dragging.cardId;
    setDragging(null);
    startTransition(async () => {
      const r = await setTaskStatus(cardId, target);
      if (!r.error) router.refresh();
    });
  }

  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="space-y-3">
    <div className="flex flex-wrap items-center gap-2" role="radiogroup" aria-label="Provenance filter">
      {FILTER_OPTIONS.map((o) => (
        <button
          key={o.key}
          type="button"
          role="radio"
          aria-checked={filter === o.key}
          onClick={() => setFilter(o.key)}
          className={
            filter === o.key
              ? 'rounded border border-agsi-navy bg-agsi-navy px-3 py-1 text-xs font-medium text-white'
              : 'rounded border border-agsi-midGray px-3 py-1 text-xs font-medium text-agsi-navy hover:bg-agsi-lightGray/40'
          }
        >
          {o.label}
        </button>
      ))}
    </div>
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {COLUMNS.map((col) => {
        const colCards = grouped[col.key];
        const isDropTarget = dragging !== null && dragging.from !== col.key;
        return (
          <div
            key={col.key}
            onDragOver={(e) => {
              if (isDropTarget) {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
              }
            }}
            onDrop={(e) => {
              if (!isDropTarget) return;
              e.preventDefault();
              handleDrop(col.key);
            }}
            className={cn(
              'flex min-h-[180px] flex-col rounded-lg border-t-2 bg-white p-2 transition-colors',
              col.tone,
              isDropTarget && 'bg-agsi-accent/5 ring-2 ring-agsi-accent/40',
              dragging?.from === col.key && 'opacity-70',
            )}
          >
            <div className="mb-2 flex items-center justify-between px-1">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-agsi-darkGray">
                {col.label}
              </h3>
              <span className="text-xs text-agsi-darkGray">{colCards.length}</span>
            </div>
            <div className="space-y-2">
              {colCards.length === 0 ? (
                <p className="rounded border border-dashed border-agsi-lightGray p-3 text-xs text-agsi-darkGray">
                  {dragging && isDropTarget ? 'Drop here' : 'Nothing here.'}
                </p>
              ) : (
                colCards.map((c) => (
                  <TaskCard
                    key={c.id}
                    card={c}
                    today={today}
                    onDragStart={() => setDragging({ cardId: c.id, from: c.status as BoardStatus })}
                    onDragEnd={() => setDragging(null)}
                    isBeingDragged={dragging?.cardId === c.id}
                  />
                ))
              )}
            </div>
          </div>
        );
      })}
    </div>
    </div>
  );
}

function TaskCard({
  card,
  today,
  onDragStart,
  onDragEnd,
  isBeingDragged,
}: {
  card: TaskKanbanCard;
  today: string;
  onDragStart: () => void;
  onDragEnd: () => void;
  isBeingDragged: boolean;
}) {
  const router = useRouter();
  const isOverdue =
    card.status !== 'done' && card.due_date !== null && card.due_date < today;
  // Every card has an edit target. Company-linked cards keep the
  // stakeholder-scoped edit surface; ad-hoc cards route to
  // /tasks?edit=<id> — closes the gap where ad-hoc rows were
  // non-editable (the pre-fix comment called it out as unfinished).
  const editHref = card.company_id
    ? (`/companies/${card.company_id}/tasks?edit=${card.id}` as const)
    : (`/tasks?edit=${card.id}` as const);

  function openEdit() {
    // HTML5 drag suppresses the click event on drop, so this fires
    // only on real clicks — no manual drag-vs-click threshold
    // needed. Keyboard support via role/tabIndex + onKeyDown below.
    router.push(editHref as never);
  }

  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move';
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      onClick={openEdit}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          openEdit();
        }
      }}
      role="button"
      tabIndex={0}
      aria-label={`Edit ${card.title}`}
      className={cn(
        // Whole-card hover + click. cursor-grab stays the primary
        // affordance (the kanban's dominant interaction is drag);
        // hover:border-agsi-navy/40 + shadow-md communicate the
        // card-level interactive surface without swapping cursors.
        'cursor-grab rounded-lg border border-agsi-lightGray bg-white p-3 shadow-sm transition-shadow transition-colors hover:border-agsi-navy/40 hover:shadow-md active:cursor-grabbing focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-agsi-accent',
        isBeingDragged && 'opacity-50',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium text-agsi-navy">{card.title}</p>
        {/* Delegation marker: when assigned_by is set, show the
            assigner avatar to the LEFT of the owner avatar with a
            small arrow — reads as "<assigner> delegated to <owner>". */}
        <div className="flex shrink-0 items-center gap-1">
          {card.assigned_by_name && (
            <>
              <Avatar
                name={card.assigned_by_name}
                size="xs"
                title={`Delegated by ${card.assigned_by_name}`}
              />
              <span className="text-xxs text-agsi-darkGray" aria-hidden>
                →
              </span>
            </>
          )}
          <Avatar
            name={card.owner_full_name}
            size="xs"
            title={`Owner: ${card.owner_full_name ?? 'Unassigned'}`}
          />
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        {card.company_id ? (
          <Link
            href={`/companies/${card.company_id}`}
            draggable={false}
            onClick={(e) => e.stopPropagation()}
            className="text-xs text-agsi-accent hover:underline"
          >
            {card.company_name ?? 'Company'}
          </Link>
        ) : (
          <Badge variant="neutral">Ad-hoc</Badge>
        )}
        {card.due_date && (
          <span
            className={cn(
              'text-xs',
              isOverdue ? 'font-semibold text-rag-red' : 'text-agsi-darkGray',
            )}
            title={isOverdue ? 'Overdue' : 'Due date'}
          >
            {isOverdue ? `Overdue · ${card.due_date}` : `Due ${card.due_date}`}
          </span>
        )}
        {card.has_reminders && (
          <span
            className="text-xs text-agsi-darkGray"
            title="Has reminders"
            aria-label="Has reminders"
          >
            🔔
          </span>
        )}
      </div>

    </div>
  );
}

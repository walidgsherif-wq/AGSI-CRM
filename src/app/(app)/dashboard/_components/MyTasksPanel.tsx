'use client';

import { useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  AlarmClockCheck,
  CalendarDays,
  Check,
  CircleCheck,
  Loader2,
} from 'lucide-react';
import { setTaskStatus } from '@/server/actions/tasks';
import type { MyTaskRow, MyTasksData } from '@/server/actions/my-tasks';
import {
  CollapsiblePanel,
  CountPulse,
} from '@/components/domain/CollapsiblePanel';

type Group = 'overdue' | 'today' | 'week' | 'later';

const GROUP_LABEL: Record<Group, string> = {
  overdue: 'Overdue',
  today: 'Due today',
  week: 'This week',
  later: 'Later / no date',
};

const GROUP_ACCENT: Record<Group, string> = {
  overdue: 'text-rag-red',
  today: 'text-rag-amber',
  week: 'text-agsi-navy',
  later: 'text-agsi-darkGray',
};

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function bucketOf(due: string | null, today: string, weekEnd: string): Group {
  if (!due) return 'later';
  if (due < today) return 'overdue';
  if (due === today) return 'today';
  if (due <= weekEnd) return 'week';
  return 'later';
}

function relativeDue(due: string | null, today: string): string {
  if (!due) return 'No date';
  if (due === today) return 'Today';
  const dueDate = new Date(due);
  const now = new Date(today);
  const days = Math.round(
    (dueDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
  );
  if (days < 0) return `${-days}d overdue`;
  if (days === 1) return 'Tomorrow';
  return `in ${days}d`;
}

/**
 * The member's own board — self-set and lead-assigned tasks
 * grouped by urgency. Complete + advance-status inline; no drill-in.
 * Sits below the ActionQueuePanel and complements it — the queue
 * surfaces urgent exceptions across every source, this is the full
 * task-only working list.
 */
export function MyTasksPanel({
  initial,
  currentUserId,
}: {
  initial: MyTasksData;
  currentUserId: string;
}) {
  const router = useRouter();
  const [data, setData] = useState<MyTasksData>(initial);
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);

  const today = todayISO();
  const weekEnd = new Date(
    new Date(today).getTime() + 6 * 24 * 60 * 60 * 1000,
  )
    .toISOString()
    .slice(0, 10);

  const groups = useMemo(() => {
    const buckets: Record<Group, MyTaskRow[]> = {
      overdue: [],
      today: [],
      week: [],
      later: [],
    };
    for (const r of data.rows) buckets[bucketOf(r.due_date, today, weekEnd)].push(r);
    return buckets;
  }, [data.rows, today, weekEnd]);

  // Momentum ratio for the thin progress bar. Deliberately quiet —
  // no percentage badge, no colour ramp, just "N of M done this week".
  const momentumDenom = data.doneLast7d + data.openNow;
  const momentumPct =
    momentumDenom === 0 ? 0 : (data.doneLast7d / momentumDenom) * 100;

  function completeTask(row: MyTaskRow) {
    setBusyId(row.id);
    startTransition(async () => {
      const res = await setTaskStatus(row.id, 'done');
      setBusyId(null);
      if ('error' in res) {
        console.error('[my-tasks] complete failed', res.error);
        return;
      }
      // Drop from the list locally + refresh so the momentum figure
      // and the sidebar bell update from server truth.
      setData((cur) => ({
        rows: cur.rows.filter((r) => r.id !== row.id),
        doneLast7d: cur.doneLast7d + 1,
        openNow: Math.max(0, cur.openNow - 1),
      }));
      router.refresh();
    });
  }

  function advanceStatus(row: MyTaskRow) {
    if (row.status !== 'open') return;
    setBusyId(row.id);
    startTransition(async () => {
      const res = await setTaskStatus(row.id, 'in_progress');
      setBusyId(null);
      if ('error' in res) return;
      setData((cur) => ({
        ...cur,
        rows: cur.rows.map((r) =>
          r.id === row.id ? { ...r, status: 'in_progress' } : r,
        ),
      }));
      router.refresh();
    });
  }

  const overdueCount = groups.overdue.length;
  const openCount = data.rows.length;

  return (
    <CollapsiblePanel
      panelId="my-tasks"
      userId={currentUserId}
      title="My tasks"
      pulse={
        <CountPulse
          overdue={overdueCount}
          open={openCount}
          calmText="Clear — nothing open"
        />
      }
      urgent={overdueCount > 0}
    >
      {/* Momentum bar + one-line context live inside the body so
          the collapsed pulse stays tight. */}
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-agsi-lightGray/40 px-4 py-2">
        <p className="text-xs text-agsi-darkGray">
          Self-set and lead-assigned. Advance or complete inline.
        </p>
        <div className="min-w-[10rem]">
          <p className="text-right text-xxs uppercase tracking-wider text-agsi-darkGray">
            {data.doneLast7d} of {momentumDenom} done this week
          </p>
          <div className="mt-1 h-1.5 w-full overflow-hidden rounded bg-agsi-lightGray/50">
            <div
              className="h-full bg-agsi-navy transition-all"
              style={{ width: `${momentumPct}%` }}
              aria-hidden
            />
          </div>
        </div>
      </div>

      {data.rows.length === 0 ? (
        <div className="flex items-center gap-3 py-6 pl-4 text-sm text-agsi-darkGray">
          <CircleCheck className="h-5 w-5 text-agsi-green" aria-hidden />
          <span>You&apos;re clear — nothing open.</span>
        </div>
      ) : (
        <div className="space-y-4 p-0 pt-1">
          {(['overdue', 'today', 'week', 'later'] as Group[]).map((g) => {
            const rows = groups[g];
            if (rows.length === 0) return null;
            return (
              <div key={g}>
                <div className="flex items-center gap-2 border-b border-agsi-lightGray/40 px-4 pb-1">
                  <span
                    className={`text-xxs font-semibold uppercase tracking-wider ${GROUP_ACCENT[g]}`}
                  >
                    {GROUP_LABEL[g]}
                  </span>
                  <span className="text-xxs text-agsi-midGray">·</span>
                  <span className="text-xxs text-agsi-darkGray">
                    {rows.length}
                  </span>
                </div>
                <ul className="divide-y divide-agsi-lightGray/60">
                  {rows.map((r) => (
                    <TaskRow
                      key={r.id}
                      row={r}
                      today={today}
                      busy={busyId === r.id && pending}
                      onComplete={() => completeTask(r)}
                      onAdvance={() => advanceStatus(r)}
                    />
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </CollapsiblePanel>
  );
}

function TaskRow({
  row,
  today,
  busy,
  onComplete,
  onAdvance,
}: {
  row: MyTaskRow;
  today: string;
  busy: boolean;
  onComplete: () => void;
  onAdvance: () => void;
}) {
  const isInProgress = row.status === 'in_progress';
  return (
    <li className="flex items-start gap-3 px-4 py-2.5">
      <button
        type="button"
        aria-label={`Complete ${row.title}`}
        title="Mark done"
        onClick={onComplete}
        disabled={busy}
        className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-agsi-midGray text-agsi-midGray transition-colors hover:border-agsi-green hover:text-agsi-green disabled:opacity-50"
      >
        {busy ? (
          <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
        ) : (
          <Check className="h-3 w-3" aria-hidden />
        )}
      </button>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-agsi-navy">
          <span className="font-medium">{row.title}</span>
          {row.company_id && row.company_name && (
            <>
              {' '}
              <span className="text-agsi-darkGray">·</span>{' '}
              <Link
                href={`/companies/${row.company_id}` as never}
                className="text-agsi-accent hover:underline"
              >
                {row.company_name}
              </Link>
            </>
          )}
        </p>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xxs text-agsi-darkGray">
          <button
            type="button"
            onClick={onAdvance}
            disabled={busy || isInProgress}
            className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 uppercase tracking-wider ${
              isInProgress
                ? 'border-agsi-navy text-agsi-navy'
                : 'border-agsi-midGray text-agsi-darkGray hover:border-agsi-navy hover:text-agsi-navy'
            }`}
            title={isInProgress ? 'In progress' : 'Move to in-progress'}
          >
            <span
              className={`inline-block h-1.5 w-1.5 rounded-full ${
                isInProgress ? 'bg-agsi-navy' : 'bg-agsi-midGray'
              }`}
              aria-hidden
            />
            {isInProgress ? 'In progress' : 'To-do'}
          </button>
          <span className="inline-flex items-center gap-1">
            <CalendarDays aria-hidden className="h-3 w-3" />
            {relativeDue(row.due_date, today)}
          </span>
          {row.assigned_by_lead && row.assigner_name && (
            <span className="rounded bg-agsi-offWhite px-1.5 text-agsi-darkGray">
              from {row.assigner_name}
            </span>
          )}
          {row.stalled && (
            <span className="inline-flex items-center gap-1 text-rag-amber">
              <AlarmClockCheck aria-hidden className="h-3 w-3" />
              stalled 7d+
            </span>
          )}
        </p>
      </div>
    </li>
  );
}

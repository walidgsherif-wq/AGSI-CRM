'use client';

import { useEffect, useState, useTransition } from 'react';
import Link from 'next/link';
import {
  AtSign,
  ChevronDown,
  ChevronUp,
  CircleCheck,
  Flag,
  ListTodo,
  ShieldCheck,
  Snowflake,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import {
  HIGH_VALUE_THRESHOLD_AED,
  relativeAge,
  type ActionItem,
  type ActionQueue,
  type ActionType,
} from '@/lib/action-queue';
import { getActionQueue } from '@/server/actions/action-queue';
import { dismissNotification } from '@/server/actions/notifications';
import {
  notifyUnreadChanged,
  subscribeUnreadChanged,
} from '@/lib/notifications-events';
import { CollapsiblePanel } from '@/components/domain/CollapsiblePanel';

const INITIAL_VISIBLE = 6;

const TYPE_ICON: Record<ActionType, React.ComponentType<{ className?: string }>> = {
  mention: AtSign,
  overdue_task: ListTodo,
  cold_high_value: Snowflake,
  pending_approval: ShieldCheck,
  claim: Flag,
};

const TYPE_ACCENT: Record<ActionType, string> = {
  mention: 'text-agsi-accent',
  overdue_task: 'text-rag-red',
  cold_high_value: 'text-agsi-navy',
  pending_approval: 'text-agsi-navy',
  // Neutral — claims are informational, not a decision. Muted grey
  // keeps them from competing with actionable rows for attention.
  claim: 'text-agsi-darkGray',
};

const TYPE_LABEL: Record<ActionType, string> = {
  mention: 'Mention',
  overdue_task: 'Overdue',
  cold_high_value: 'Cold',
  pending_approval: 'Approval',
  claim: 'Claim',
};

export function ActionQueuePanel({
  greetingName,
  queue: initialQueue,
  currentUserId,
}: {
  greetingName: string;
  queue: ActionQueue;
  currentUserId: string;
}) {
  const [expanded, setExpanded] = useState(false);
  // Seeded from the server render so first paint has data; live-
  // updated when the shared notifications bus fires (realtime
  // fanout from NotificationsRealtime + the existing in-tab
  // triggers from markRead / dismiss / etc).
  const [queue, setQueue] = useState<ActionQueue>(initialQueue);

  useEffect(() => {
    return subscribeUnreadChanged(() => {
      void getActionQueue()
        .then((next) => setQueue(next))
        .catch(() => {
          // Auth blip / RLS transient — the next event or a
          // full-page navigation will reconcile.
        });
    });
  }, []);

  const now = new Date();
  const items = queue.items;
  const visible = expanded ? items : items.slice(0, INITIAL_VISIBLE);
  const hiddenCount = Math.max(0, items.length - visible.length);
  const firstName = greetingName.split(' ')[0] || greetingName;

  // Pulse text — always visible on the collapsed header. Urgent
  // when any item is queued (each entry is by definition something
  // needing attention).
  const pulse =
    items.length === 0 ? (
      <span className="italic text-agsi-darkGray">You&apos;re clear today</span>
    ) : (
      <span className="font-medium text-agsi-navy">
        {items.length} {items.length === 1 ? 'thing needs' : 'things need'} you today
      </span>
    );

  return (
    <CollapsiblePanel
      panelId="action-queue"
      userId={currentUserId}
      title={`${greeting()} ${firstName}`}
      pulse={pulse}
      urgent={items.length > 0}
    >
      {items.length > 0 && (
        <div className="flex flex-wrap items-center justify-end gap-2 border-b border-agsi-lightGray/40 px-4 py-2">
          <QueueLegend items={items} />
        </div>
      )}

      {items.length === 0 ? (
        <div className="flex items-center gap-3 py-6 pl-4 text-sm text-agsi-darkGray">
          <CircleCheck className="h-5 w-5 text-agsi-green" aria-hidden />
          <span>Nothing waiting on you — good time to prospect.</span>
        </div>
      ) : (
        <div className="p-0">
          <ul className="divide-y divide-agsi-lightGray/70">
            {visible.map((item) => (
              <ActionRow key={item.key} item={item} now={now} />
            ))}
          </ul>
          {hiddenCount > 0 && (
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className="flex w-full items-center justify-center gap-1 border-t border-agsi-lightGray/60 py-2 text-xs text-agsi-darkGray hover:bg-agsi-offWhite/60 hover:text-agsi-navy"
            >
              <ChevronDown aria-hidden className="h-3.5 w-3.5" />
              Show {hiddenCount} more
            </button>
          )}
          {expanded && items.length > INITIAL_VISIBLE && (
            <button
              type="button"
              onClick={() => setExpanded(false)}
              className="flex w-full items-center justify-center gap-1 border-t border-agsi-lightGray/60 py-2 text-xs text-agsi-darkGray hover:bg-agsi-offWhite/60 hover:text-agsi-navy"
            >
              <ChevronUp aria-hidden className="h-3.5 w-3.5" />
              Collapse
            </button>
          )}
        </div>
      )}
    </CollapsiblePanel>
  );
}

function ActionRow({ item, now }: { item: ActionItem; now: Date }) {
  const Icon = TYPE_ICON[item.type];
  const iconClass = TYPE_ACCENT[item.type];
  const highValue =
    item.type === 'cold_high_value' &&
    (item.value_aed ?? 0) >= HIGH_VALUE_THRESHOLD_AED;
  const isClaim = item.type === 'claim';
  const [pending, startTransition] = useTransition();

  function acknowledge() {
    if (!item.notification_id) return;
    const nid = item.notification_id;
    startTransition(async () => {
      await dismissNotification(nid);
      // Fire the shared bus so the bell + this panel (and any other
      // unread-count consumer) refetches. The panel's own useEffect
      // subscription rebuilds the queue and this row disappears.
      notifyUnreadChanged();
    });
  }

  // Body content is identical for every type — only the trailing
  // trailing affordance differs. Claim rows split link vs. button;
  // the others keep the whole row as a single Link for a bigger click
  // target (matches the pre-claim behavior).
  const body = (
    <>
      <span className={`mt-0.5 shrink-0 ${iconClass}`}>
        <Icon aria-hidden className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-agsi-navy">
          <strong className="font-semibold">{item.company.canonical_name}</strong>
          <span className="text-agsi-darkGray"> — {item.reason}</span>
        </p>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xxs text-agsi-darkGray">
          <span className="uppercase tracking-wider text-agsi-midGray">
            {TYPE_LABEL[item.type]}
          </span>
          <span className="text-agsi-midGray">·</span>
          <span>{item.context}</span>
          <span className="text-agsi-midGray">·</span>
          <span>{relativeAge(item.occurred_at, now)}</span>
          {highValue && (
            <Badge variant="gold" className="ml-1">
              High value
            </Badge>
          )}
        </p>
      </div>
    </>
  );

  if (isClaim) {
    return (
      <li className="group flex items-start gap-3 px-4 py-2.5 transition-colors hover:bg-agsi-offWhite/60">
        <Link
          href={item.link_url as never}
          className="flex min-w-0 flex-1 items-start gap-3"
        >
          {body}
        </Link>
        <div className="mt-0.5 flex shrink-0 items-center gap-2">
          <Link
            href={item.link_url as never}
            className="text-xxs uppercase tracking-wider text-agsi-midGray hover:text-agsi-accent"
          >
            Open →
          </Link>
          <button
            type="button"
            onClick={acknowledge}
            disabled={pending || !item.notification_id}
            aria-label="Acknowledge claim notification"
            className="rounded border border-agsi-midGray bg-white px-2 py-0.5 text-xxs font-medium uppercase tracking-wider text-agsi-navy transition-colors hover:bg-agsi-lightGray/40 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pending ? '…' : 'OK'}
          </button>
        </div>
      </li>
    );
  }

  return (
    <li>
      <Link
        href={item.link_url as never}
        className="group flex items-start gap-3 px-4 py-2.5 transition-colors hover:bg-agsi-offWhite/60"
      >
        {body}
        <span className="mt-1 shrink-0 text-xxs uppercase tracking-wider text-agsi-midGray group-hover:text-agsi-accent">
          Open →
        </span>
      </Link>
    </li>
  );
}

function QueueLegend({ items }: { items: ActionItem[] }) {
  const counts: Record<ActionType, number> = {
    mention: 0,
    overdue_task: 0,
    cold_high_value: 0,
    pending_approval: 0,
    claim: 0,
  };
  for (const it of items) counts[it.type] += 1;
  const entries = (
    [
      'overdue_task',
      'mention',
      'cold_high_value',
      'pending_approval',
      'claim',
    ] as ActionType[]
  ).filter((t) => counts[t] > 0);
  if (entries.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2 text-xxs text-agsi-darkGray">
      {entries.map((t) => {
        const Icon = TYPE_ICON[t];
        return (
          <span
            key={t}
            className="inline-flex items-center gap-1 rounded-full border border-agsi-lightGray px-2 py-0.5"
          >
            <Icon aria-hidden className={`h-3 w-3 ${TYPE_ACCENT[t]}`} />
            <span>
              {counts[t]} {TYPE_LABEL[t].toLowerCase()}
              {counts[t] === 1 ? '' : 's'}
            </span>
          </span>
        );
      })}
    </div>
  );
}

function greeting(): string {
  const h = new Date().getHours();
  if (h < 5) return 'Good night,';
  if (h < 12) return 'Good morning,';
  if (h < 17) return 'Good afternoon,';
  return 'Good evening,';
}

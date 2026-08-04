'use client';

import Link from 'next/link';
import { Users } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import type { AssignedByMeRow } from '@/server/actions/my-tasks';
import {
  CollapsiblePanel,
  CountPulse,
} from '@/components/domain/CollapsiblePanel';

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Admin/bd_head-only lead view: open tasks the caller assigned to
 * other members. Read-only surface — the lead nudges/reassigns from
 * the stakeholder Tasks tab; this panel is a status barometer, not
 * an editor.
 *
 * Wrapped in CollapsiblePanel — pulse ("N overdue · M open") stays
 * visible on the collapsed header so delegated urgency never hides.
 */
export function AssignedByMePanel({
  rows,
  currentUserId,
}: {
  rows: AssignedByMeRow[];
  currentUserId: string;
}) {
  const today = todayISO();
  const overdue = rows.filter((r) => r.due_date && r.due_date < today).length;
  const stalled = rows.filter((r) => r.stalled).length;
  const openCount = rows.length;

  return (
    <CollapsiblePanel
      panelId="assigned-by-me"
      userId={currentUserId}
      title="Tasks I've assigned"
      pulse={
        <CountPulse
          overdue={overdue}
          open={openCount}
          calmText="Nothing outstanding"
        />
      }
      urgent={overdue > 0}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-agsi-lightGray/40 px-4 py-2">
        <p className="text-xs text-agsi-darkGray">
          Delegated work still open — nudge from here; edit on the
          stakeholder Tasks tab.
        </p>
        {stalled > 0 && (
          <span className="inline-flex items-center gap-1 rounded-full border border-rag-amber/40 px-2 py-0.5 text-xxs text-rag-amber">
            {stalled} stalled
          </span>
        )}
      </div>

      {rows.length === 0 ? (
        <div className="flex items-center gap-3 py-6 pl-4 text-sm text-agsi-darkGray">
          <Users aria-hidden className="h-5 w-5 text-agsi-darkGray" />
          <span>Nothing outstanding — every task you assigned is done.</span>
        </div>
      ) : (
        <ul className="divide-y divide-agsi-lightGray/60">
          {rows.map((r) => {
            const overdueRow = r.due_date && r.due_date < today;
            return (
              <li key={r.id} className="flex items-start gap-3 px-4 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-agsi-navy">
                    <span className="font-medium">{r.title}</span>
                    {r.company_id && r.company_name && (
                      <>
                        {' '}
                        <span className="text-agsi-darkGray">·</span>{' '}
                        <Link
                          href={`/companies/${r.company_id}` as never}
                          className="text-agsi-accent hover:underline"
                        >
                          {r.company_name}
                        </Link>
                      </>
                    )}
                  </p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xxs text-agsi-darkGray">
                    <span>
                      Assigned to{' '}
                      <strong className="font-medium text-agsi-navy">
                        {r.assignee_name ?? 'Unknown'}
                      </strong>
                    </span>
                    <span>·</span>
                    <span>
                      {r.status === 'in_progress' ? 'In progress' : 'To-do'}
                    </span>
                    {r.due_date && (
                      <>
                        <span>·</span>
                        <span
                          className={
                            overdueRow ? 'text-rag-red' : 'text-agsi-darkGray'
                          }
                        >
                          due {r.due_date}
                        </span>
                      </>
                    )}
                    {r.stalled && (
                      <Badge variant="amber" className="ml-1">
                        stalled 7d+
                      </Badge>
                    )}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </CollapsiblePanel>
  );
}

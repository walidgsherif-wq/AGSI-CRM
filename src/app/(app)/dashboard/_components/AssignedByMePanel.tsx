import Link from 'next/link';
import { AlertTriangle, Users } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { AssignedByMeRow } from '@/server/actions/my-tasks';

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Admin/bd_head-only lead view: open tasks the caller assigned to
 * other members. Read-only surface — the lead nudges/reassigns from
 * the stakeholder Tasks tab; this panel is a status barometer, not
 * an editor. Never rendered for bd_manager (dashboard gates the
 * mount too, so getAssignedByMe is called only in-role).
 */
export function AssignedByMePanel({ rows }: { rows: AssignedByMeRow[] }) {
  const today = todayISO();
  const overdue = rows.filter((r) => r.due_date && r.due_date < today).length;
  const stalled = rows.filter((r) => r.stalled).length;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <CardTitle>Tasks I&apos;ve assigned</CardTitle>
            <CardDescription>
              Delegated work still open — a status barometer for
              nudging. Editing / reassignment lives on each
              stakeholder&apos;s Tasks tab.
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xxs text-agsi-darkGray">
            {overdue > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full border border-rag-red/40 px-2 py-0.5 text-rag-red">
                <AlertTriangle aria-hidden className="h-3 w-3" />
                {overdue} overdue
              </span>
            )}
            {stalled > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full border border-rag-amber/40 px-2 py-0.5 text-rag-amber">
                {stalled} stalled
              </span>
            )}
            <span>{rows.length} open</span>
          </div>
        </div>
      </CardHeader>

      {rows.length === 0 ? (
        <CardContent className="flex items-center gap-3 border-t border-agsi-lightGray/60 py-6 text-sm text-agsi-darkGray">
          <Users aria-hidden className="h-5 w-5 text-agsi-darkGray" />
          <span>Nothing outstanding — every task you assigned is done.</span>
        </CardContent>
      ) : (
        <CardContent className="p-0">
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
        </CardContent>
      )}
    </Card>
  );
}

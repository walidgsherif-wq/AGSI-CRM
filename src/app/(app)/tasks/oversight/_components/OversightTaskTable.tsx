'use client';

import Link from 'next/link';
import type { Route } from 'next';
import { type ColumnDef } from '@tanstack/react-table';
import { Badge } from '@/components/ui/badge';
import { Avatar } from '@/components/ui/avatar';
import { DataTable } from '@/components/ui/data-table';
import { cn } from '@/lib/utils';
import { TASK_STATUS_LABEL, type TaskStatus } from '@/lib/zod/task';

export type OversightTaskRow = {
  id: string;
  title: string;
  due_date: string | null;
  status: TaskStatus;
  owner_id: string;
  assigned_by_id: string | null;
  company_id: string | null;
  owner: { full_name: string } | null;
  assigned_by: { full_name: string } | null;
  company: { id: string; canonical_name: string } | null;
  /** Derived server-side so the client sort stays a pure comparator. */
  is_overdue: boolean;
};

const columns: ColumnDef<OversightTaskRow, unknown>[] = [
  {
    id: 'title',
    accessorKey: 'title',
    header: 'Task',
    cell: ({ row }) => {
      const t = row.original;
      // Every row is editable — ad-hoc tasks route to /tasks?edit=<id>
      // so the company-linked fallback isn't the only edit surface.
      const editHref: Route = t.company_id
        ? (`/companies/${t.company_id}/tasks?edit=${t.id}` as Route)
        : (`/tasks?edit=${t.id}` as Route);
      return (
        <span
          className={cn(
            'block',
            (t.status === 'done' || t.status === 'cancelled') && 'opacity-60',
          )}
        >
          <Link href={editHref} className="font-medium text-agsi-navy hover:underline">
            {t.title}
          </Link>
        </span>
      );
    },
  },
  {
    id: 'assignee',
    accessorFn: (r) => r.owner?.full_name ?? '',
    header: 'Assignee',
    cell: ({ row }) => (
      <div className="flex items-center gap-2 text-agsi-darkGray">
        <Avatar name={row.original.owner?.full_name ?? null} size="xs" />
        {row.original.owner?.full_name ?? '—'}
      </div>
    ),
  },
  {
    id: 'company',
    accessorFn: (r) => r.company?.canonical_name ?? '',
    header: 'Linked to',
    cell: ({ row }) =>
      row.original.company ? (
        <Link
          href={`/companies/${row.original.company.id}` as Route}
          className="text-agsi-navy hover:underline"
        >
          {row.original.company.canonical_name}
        </Link>
      ) : (
        <Badge variant="neutral">Ad-hoc</Badge>
      ),
  },
  {
    id: 'due',
    // Sort by overdue first, then by due_date ascending. Nulls (no due
    // date) trail. Click the header to invert overall direction —
    // overdue rows still cluster but the secondary date order flips.
    accessorFn: (r) => r.due_date ?? '9999-99-99',
    header: 'Due',
    sortingFn: (a, b) => {
      const aOver = a.original.is_overdue ? 1 : 0;
      const bOver = b.original.is_overdue ? 1 : 0;
      if (aOver !== bOver) return bOver - aOver;
      const aDate = a.original.due_date ?? '9999-99-99';
      const bDate = b.original.due_date ?? '9999-99-99';
      return aDate.localeCompare(bDate);
    },
    cell: ({ row }) => (
      <span
        className={cn(
          'tabular-nums',
          row.original.is_overdue ? 'font-semibold text-rag-red' : 'text-agsi-darkGray',
        )}
      >
        {row.original.due_date ?? '—'}
        {row.original.is_overdue && ' · overdue'}
      </span>
    ),
  },
  {
    id: 'status',
    accessorKey: 'status',
    header: 'Status',
    cell: ({ row }) => (
      <span className="text-xs text-agsi-darkGray">
        {TASK_STATUS_LABEL[row.original.status]}
      </span>
    ),
  },
  {
    id: 'assigned_by',
    accessorFn: (r) => r.assigned_by?.full_name ?? '',
    header: 'Assigned by',
    cell: ({ row }) => (
      <span className="text-xs text-agsi-darkGray">
        {row.original.assigned_by?.full_name ?? '—'}
      </span>
    ),
  },
];

export function OversightTaskTable({ tasks }: { tasks: OversightTaskRow[] }) {
  return (
    <DataTable
      data={tasks}
      columns={columns}
      ariaLabel="All team tasks"
      minWidth="720px"
      // Default sort: overdue rows first, then soonest due. Most useful
      // for a bd_head opening the page.
      initialSort={[{ id: 'due', desc: false }]}
      empty={{
        title: 'No tasks match these filters',
        description:
          'Clear the member / status / overdue chips above to see the full list.',
      }}
    />
  );
}

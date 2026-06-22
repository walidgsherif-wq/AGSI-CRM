'use client';

import * as React from 'react';
import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from '@tanstack/react-table';
import { EmptyState } from '@/components/ui/empty-state';
import { cn } from '@/lib/utils';

export type DataTableColumn<T> = ColumnDef<T, unknown>;

export interface DataTableProps<T> {
  data: T[];
  columns: DataTableColumn<T>[];
  /** Initial client-side sort. TanStack format. */
  initialSort?: SortingState;
  /** Shown when `data` is empty. Override with a custom EmptyState if needed. */
  empty?: {
    title: string;
    description?: string;
    icon?: React.ReactNode;
  };
  /** Minimum table width — wraps in overflow-x-auto for horizontal scroll. */
  minWidth?: string;
  /** Sticky <thead>. Default: true. */
  stickyHeader?: boolean;
  /** Accessibility label for the <table>. */
  ariaLabel?: string;
  className?: string;
}

/**
 * Sortable, sticky-header, compact-density table built on TanStack
 * (headless). Each ColumnDef carries its own header label, accessor,
 * and cell renderer; the primitive just wires sorting + layout +
 * empty state. Wrap row content in `<Link>` inside the column's
 * `cell` if you want navigation — that keeps individual targets
 * keyboard-accessible without making the whole row a single tab stop.
 */
export function DataTable<T>({
  data,
  columns,
  initialSort = [],
  empty = { title: 'No rows', description: 'Nothing matches the current filters.' },
  minWidth,
  stickyHeader = true,
  ariaLabel,
  className,
}: DataTableProps<T>) {
  const [sorting, setSorting] = React.useState<SortingState>(initialSort);

  const table = useReactTable({
    data,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  if (data.length === 0) {
    return <EmptyState title={empty.title} description={empty.description} icon={empty.icon} />;
  }

  return (
    <div className={cn('overflow-x-auto', className)}>
      <table
        aria-label={ariaLabel}
        className="w-full text-sm"
        style={minWidth ? { minWidth } : undefined}
      >
        <thead className={cn(stickyHeader && 'sticky top-0 z-10 bg-white')}>
          {table.getHeaderGroups().map((hg) => (
            <tr
              key={hg.id}
              className="border-b border-agsi-lightGray text-left text-xs uppercase tracking-wider text-agsi-darkGray"
            >
              {hg.headers.map((h) => {
                const canSort = h.column.getCanSort();
                const sortDir = h.column.getIsSorted();
                return (
                  <th
                    key={h.id}
                    className={cn(
                      'px-4 py-2 font-medium',
                      canSort && 'cursor-pointer select-none hover:text-agsi-navy',
                    )}
                    onClick={canSort ? h.column.getToggleSortingHandler() : undefined}
                    aria-sort={
                      sortDir === 'asc'
                        ? 'ascending'
                        : sortDir === 'desc'
                          ? 'descending'
                          : canSort
                            ? 'none'
                            : undefined
                    }
                  >
                    <span className="inline-flex items-center gap-1">
                      {h.isPlaceholder
                        ? null
                        : flexRender(h.column.columnDef.header, h.getContext())}
                      {canSort && (
                        <span
                          aria-hidden
                          className={cn(
                            'inline-block text-xxs',
                            sortDir ? 'text-agsi-navy' : 'text-agsi-midGray',
                          )}
                        >
                          {sortDir === 'asc' ? '↑' : sortDir === 'desc' ? '↓' : '↕'}
                        </span>
                      )}
                    </span>
                  </th>
                );
              })}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row) => (
            <tr key={row.id} className="border-b border-agsi-lightGray/50">
              {row.getVisibleCells().map((cell) => (
                <td key={cell.id} className="px-4 py-2 align-top">
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

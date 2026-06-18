'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { deleteRebarPrice, type RebarPriceRow } from '@/server/actions/insights';
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/table';

export function PriceTable({ rows }: { rows: RebarPriceRow[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  if (rows.length === 0) {
    return (
      <p className="px-6 py-4 text-sm text-agsi-darkGray">
        No prices entered yet. Add the first one above.
      </p>
    );
  }

  return (
    <Table>
      <THead>
        <TR head>
          <TH className="px-4">Month</TH>
          <TH className="px-4">Price (AED/t)</TH>
          <TH className="px-4">Notes</TH>
          <TH className="px-4">Entered</TH>
          <TH className="px-4"></TH>
        </TR>
      </THead>
      <TBody>
        {rows.map((r) => (
          <TR key={r.id}>
            <TD className="px-4 py-2 font-medium text-agsi-navy">
              {r.effective_month.slice(0, 7)}
            </TD>
            <TD className="px-4 py-2 tabular-nums text-agsi-navy">
              {new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(
                r.price_aed_per_tonne,
              )}
            </TD>
            <TD className="px-4 py-2 text-xs text-agsi-darkGray">{r.notes ?? '—'}</TD>
            <TD className="px-4 py-2 text-xs text-agsi-darkGray">
              {new Date(r.entered_at).toISOString().slice(0, 10)}
              {r.entered_by_name ? ` by ${r.entered_by_name}` : ''}
            </TD>
            <TD className="px-4 py-2 text-right">
              <button
                type="button"
                disabled={pending}
                onClick={() => {
                  if (!confirm(`Delete the ${r.effective_month.slice(0, 7)} price entry?`)) return;
                  startTransition(async () => {
                    await deleteRebarPrice(r.id);
                    router.refresh();
                  });
                }}
                className="text-xs text-rag-red hover:underline disabled:opacity-50"
              >
                Delete
              </button>
            </TD>
          </TR>
        ))}
      </TBody>
    </Table>
  );
}

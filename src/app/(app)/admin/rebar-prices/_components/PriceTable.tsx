'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { deleteRebarPrice, type RebarPriceRow } from '@/server/actions/insights';

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
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-agsi-darkGray">
          <th className="px-4 py-2">Month</th>
          <th className="px-4 py-2">Price (AED/t)</th>
          <th className="px-4 py-2">Notes</th>
          <th className="px-4 py-2">Entered</th>
          <th className="px-4 py-2"></th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id} className="border-t border-agsi-lightGray">
            <td className="px-4 py-2 font-medium text-agsi-navy">
              {r.effective_month.slice(0, 7)}
            </td>
            <td className="px-4 py-2 tabular-nums text-agsi-navy">
              {new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(
                r.price_aed_per_tonne,
              )}
            </td>
            <td className="px-4 py-2 text-xs text-agsi-darkGray">{r.notes ?? '—'}</td>
            <td className="px-4 py-2 text-xs text-agsi-darkGray">
              {new Date(r.entered_at).toISOString().slice(0, 10)}
              {r.entered_by_name ? ` by ${r.entered_by_name}` : ''}
            </td>
            <td className="px-4 py-2 text-right">
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
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

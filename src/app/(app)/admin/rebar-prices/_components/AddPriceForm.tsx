'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { addRebarPrice } from '@/server/actions/insights';

export function AddPriceForm() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<{ ok?: true; error?: string } | null>(null);

  return (
    <form
      action={(formData) => {
        setStatus(null);
        startTransition(async () => {
          const r = await addRebarPrice(formData);
          if (r.error) setStatus({ error: r.error });
          else {
            setStatus({ ok: true });
            router.refresh();
            (document.getElementById('rebar-price-form') as HTMLFormElement | null)?.reset();
          }
        });
      }}
      id="rebar-price-form"
      className="grid gap-3 sm:grid-cols-[180px_180px_1fr_auto] sm:items-end"
    >
      <div>
        <label className="block text-xs font-medium text-agsi-darkGray">
          Effective month
        </label>
        <input
          name="effective_month"
          type="month"
          required
          className="mt-1 w-full rounded-lg border border-agsi-midGray bg-white px-3 py-2 text-sm"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-agsi-darkGray">
          Price (AED / tonne)
        </label>
        <input
          name="price_aed_per_tonne"
          type="number"
          required
          min={1}
          step={1}
          placeholder="2400"
          className="mt-1 w-full rounded-lg border border-agsi-midGray bg-white px-3 py-2 text-sm"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-agsi-darkGray">
          Notes (optional)
        </label>
        <input
          name="notes"
          type="text"
          maxLength={200}
          placeholder="Source, supplier, etc."
          className="mt-1 w-full rounded-lg border border-agsi-midGray bg-white px-3 py-2 text-sm"
        />
      </div>
      <div className="sm:pb-1">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? 'Saving…' : 'Add price'}
        </Button>
      </div>
      {status?.ok && (
        <p className="sm:col-span-4 text-xs text-agsi-green">Saved.</p>
      )}
      {status?.error && (
        <p className="sm:col-span-4 text-xs text-rag-red">{status.error}</p>
      )}
    </form>
  );
}

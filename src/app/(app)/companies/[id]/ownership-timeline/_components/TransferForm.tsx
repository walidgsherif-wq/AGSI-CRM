'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { transferOwnership } from '@/server/actions/level';

type ProfileOption = { id: string; full_name: string; role: string };

export function TransferForm({
  companyId,
  currentOwnerId,
  profiles,
}: {
  companyId: string;
  currentOwnerId: string | null;
  profiles: ProfileOption[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  async function onSubmit(formData: FormData) {
    setError(null);
    setInfo(null);
    startTransition(async () => {
      const r = await transferOwnership(formData);
      if (r.error) setError(r.error);
      else {
        setInfo(`Transferred — ${r.rows_reattributed ?? 0} history rows reattributed.`);
        setOpen(false);
        router.refresh();
      }
    });
  }

  if (!open) {
    return (
      <Button onClick={() => setOpen(true)} size="sm">
        Transfer ownership
      </Button>
    );
  }

  const candidates = profiles.filter((p) => p.id !== currentOwnerId);

  return (
    <form
      action={onSubmit}
      className="space-y-3 rounded-xl border border-agsi-lightGray bg-white p-4"
    >
      <input type="hidden" name="company_id" value={companyId} />
      <div>
        <label className="block text-xs font-medium text-agsi-darkGray">New owner</label>
        <select
          name="new_owner_id"
          required
          className="mt-1 w-full rounded-lg border border-agsi-midGray bg-white px-3 py-2 text-sm"
        >
          <option value="">— Select a new owner —</option>
          {candidates.map((p) => (
            <option key={p.id} value={p.id}>
              {p.full_name} ({p.role})
            </option>
          ))}
        </select>
      </div>
      <label className="flex items-start gap-2 rounded-lg border border-agsi-lightGray bg-agsi-lightGray/30 p-3 text-xs text-agsi-navy">
        <input
          type="checkbox"
          name="transfer_credit"
          defaultChecked
          className="mt-0.5 h-4 w-4 rounded"
        />
        <span>
          <strong>Transfer credit history to the new owner.</strong> Default per §16 D-8 — every
          row of <code>level_history.owner_at_time</code> is rewritten so KPI scoring
          re-attributes retroactively. Uncheck to preserve the prior owner&apos;s credit (e.g.
          legitimate mid-year onboarding).
        </span>
      </label>
      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? 'Transferring…' : 'Confirm transfer'}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
          Cancel
        </Button>
        {error && <p className="text-xs text-rag-red">{error}</p>}
        {info && <p className="text-xs text-agsi-green">{info}</p>}
      </div>
    </form>
  );
}

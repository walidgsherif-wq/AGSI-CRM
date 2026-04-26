'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { LEVELS, type Level } from '@/types/domain';
import { changeCompanyLevel } from '@/server/actions/level';

export function LevelChangeButton({
  companyId,
  companyName,
  currentLevel,
}: {
  companyId: string;
  companyName: string;
  currentLevel: Level;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  async function onSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const r = await changeCompanyLevel(formData);
      if (r.error) setError(r.error);
      else {
        setOpen(false);
        router.refresh();
      }
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs text-agsi-accent hover:underline"
      >
        Change level →
      </button>
    );
  }

  const targetOptions = LEVELS.filter((l) => l !== currentLevel);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-agsi-navy/50 p-4">
      <form
        action={onSubmit}
        className="w-full max-w-md space-y-4 rounded-xl border border-agsi-lightGray bg-white p-5 shadow-xl"
      >
        <input type="hidden" name="company_id" value={companyId} />
        <div>
          <h3 className="text-lg font-semibold text-agsi-navy">Change level</h3>
          <p className="mt-1 text-sm text-agsi-darkGray">
            <strong>{companyName}</strong> is currently at <strong>{currentLevel}</strong>.
          </p>
        </div>

        <div>
          <label className="block text-xs font-medium text-agsi-darkGray">Move to</label>
          <select
            name="to_level"
            required
            defaultValue={targetOptions[0]}
            className="mt-1 w-full rounded-lg border border-agsi-midGray bg-white px-3 py-2 text-sm"
          >
            {targetOptions.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-agsi-darkGray">
            Forward moves credit the current owner; backward moves are recorded but uncredited.
          </p>
        </div>

        <div>
          <label className="block text-xs font-medium text-agsi-darkGray">Evidence note</label>
          <textarea
            name="evidence_note"
            rows={3}
            placeholder="What progressed this stakeholder? (Required for audit.)"
            className="mt-1 w-full rounded-lg border border-agsi-midGray bg-white px-3 py-2 text-sm"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-agsi-darkGray">
            Evidence link (optional)
          </label>
          <input
            name="evidence_file_url"
            type="url"
            placeholder="https://… (drive link, signed PDF URL, etc.)"
            className="mt-1 w-full rounded-lg border border-agsi-midGray bg-white px-3 py-2 text-sm"
          />
          <p className="mt-1 text-xs text-agsi-darkGray">
            For L4 transitions a signed MOU document on this company is recommended (§16 D-6).
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Button type="submit" size="sm" disabled={pending}>
            {pending ? 'Saving…' : 'Confirm change'}
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          {error && <p className="text-xs text-rag-red">{error}</p>}
        </div>
      </form>
    </div>
  );
}

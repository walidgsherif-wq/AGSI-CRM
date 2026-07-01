'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import * as Dialog from '@radix-ui/react-dialog';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { setInitialLevel } from '@/server/actions/setup-mode';
import { LEVELS, type Level } from '@/types/domain';

/**
 * "Set current level" — backfill button. Only rendered when CRM setup
 * mode is on and the caller is either the owner or bd_head/admin.
 *
 * No single-step rule, no approval, no evidence upload. The completeness
 * gate (emirate + work-email contact) is still enforced server-side;
 * failures surface inline so the user knows to add those details first.
 */
export function SetInitialLevelButton({
  companyId,
  currentLevel,
}: {
  companyId: string;
  currentLevel: Level;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [toLevel, setToLevel] = useState<Level>(() => {
    const idx = LEVELS.indexOf(currentLevel);
    return LEVELS[Math.min(idx + 1, LEVELS.length - 1)];
  });
  const [note, setNote] = useState('');

  async function submit() {
    setError(null);
    startTransition(async () => {
      const r = await setInitialLevel({
        companyId,
        toLevel,
        note,
      });
      if (r.error) {
        setError(r.error);
        return;
      }
      setOpen(false);
      setNote('');
      router.refresh();
    });
  }

  const targetOptions = LEVELS.filter((lv) => lv > currentLevel);

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setError(null);
      }}
    >
      <Dialog.Trigger asChild>
        <Button size="sm" variant="outline">
          Set current level (setup)
        </Button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-agsi-navy/50" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 p-4 focus:outline-none"
          aria-describedby={undefined}
        >
          <div className="max-h-[90vh] space-y-4 overflow-y-auto rounded-xl border border-agsi-lightGray bg-white p-5 shadow-xl">
            <Dialog.Title className="text-lg font-semibold text-agsi-navy">
              Set current level
            </Dialog.Title>
            <p className="text-xs text-agsi-darkGray">
              Backfill the true current level for this stakeholder. Does
              not count toward earned Driver A. Audited. Requires an
              emirate and a work-email contact for L2 or higher.
            </p>

            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-agsi-darkGray">
                Target level
              </span>
              <Select
                value={toLevel}
                onChange={(e) => setToLevel(e.target.value as Level)}
              >
                {targetOptions.map((lv) => (
                  <option key={lv} value={lv}>
                    {lv}
                  </option>
                ))}
              </Select>
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-agsi-darkGray">
                Note (optional)
              </span>
              <Textarea
                rows={2}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="e.g. Already at L4 pre-CRM; MOU signed 2025-Q3."
              />
            </label>

            {error && <p className="text-xs text-rag-red">{error}</p>}

            <div className="flex items-center justify-end gap-2">
              <Dialog.Close asChild>
                <Button type="button" size="sm" variant="ghost" disabled={pending}>
                  Cancel
                </Button>
              </Dialog.Close>
              <Button
                type="button"
                size="sm"
                disabled={pending || targetOptions.length === 0}
                onClick={submit}
              >
                {pending ? 'Saving…' : `Set to ${toLevel}`}
              </Button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

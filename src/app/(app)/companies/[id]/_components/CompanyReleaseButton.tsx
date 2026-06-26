'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import * as Dialog from '@radix-ui/react-dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { unclaimCompany } from '@/server/actions/companies';

/**
 * Secondary, de-emphasised "Release stakeholder" link. Rendered to:
 *   - the current owner (companies.owner_id === user.id)
 *   - admin and bd_head
 *
 * Click opens a confirmation dialog with the consequence statement +
 * required reason textarea. Submits to the unclaim_company RPC (via the
 * unclaimCompany server action). On success the page refreshes; the
 * Claim button reappears because owner_id is now null.
 */
export function CompanyReleaseButton({
  companyId,
  companyName,
}: {
  companyId: string;
  companyName: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit() {
    setError(null);
    const trimmed = reason.trim();
    if (!trimmed) {
      setError('Please add a short reason.');
      return;
    }
    startTransition(async () => {
      const r = await unclaimCompany(companyId, trimmed);
      if (r.error) {
        setError(r.error);
        return;
      }
      setOpen(false);
      setReason('');
      router.refresh();
    });
  }

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setError(null);
        }
      }}
    >
      <Dialog.Trigger asChild>
        <button
          type="button"
          className="text-xs font-medium text-agsi-darkGray underline-offset-2 hover:text-rag-red hover:underline"
        >
          Release stakeholder
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-agsi-navy/50" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 p-4 focus:outline-none"
          aria-describedby={undefined}
        >
          <div className="space-y-4 rounded-xl border border-agsi-lightGray bg-white p-5 shadow-xl">
            <Dialog.Title className="text-lg font-semibold text-agsi-navy">
              Release {companyName}?
            </Dialog.Title>
            <p className="text-sm text-agsi-darkGray">
              Releases <strong>{companyName}</strong> back to unclaimed; anyone
              can then claim it. Your logged engagements, contacts, and the
              current level are kept.
            </p>
            <div>
              <label className="block text-xs font-medium text-agsi-darkGray">
                Reason <span className="text-rag-red">*</span>
              </label>
              <Textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={3}
                placeholder="e.g. Handing back — no traction after three months. Reassign to whoever picks it up."
                className="mt-1"
                required
              />
            </div>
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
                variant="danger"
                onClick={onSubmit}
                disabled={pending}
              >
                {pending ? 'Releasing…' : 'Release'}
              </Button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

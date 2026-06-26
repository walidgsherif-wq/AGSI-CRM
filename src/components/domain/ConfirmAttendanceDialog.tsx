'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import * as Dialog from '@radix-ui/react-dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { confirmAttendance } from '@/server/actions/events';
import {
  EventProofUploader,
  type UploadedProof,
} from '@/components/domain/EventProofUploader';

/**
 * Confirm-attendance modal — flips a planned event to attended.
 * Captures the value-gained note and feedback, and lets the member
 * attach a badge photo as proof. Proof is optional; uploading one
 * promotes the row to Verified in the UI.
 */
export function ConfirmAttendanceDialog({
  eventId,
  eventName,
  memberId,
  trigger,
  open: controlledOpen,
  onOpenChange,
}: {
  eventId: string;
  eventName: string;
  memberId: string;
  trigger?: React.ReactNode;
  open?: boolean;
  onOpenChange?: (next: boolean) => void;
}) {
  const router = useRouter();
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const setOpen = (next: boolean) => {
    if (onOpenChange) onOpenChange(next);
    else setInternalOpen(next);
  };
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [proof, setProof] = useState<UploadedProof | null>(null);

  async function onSubmit(formData: FormData) {
    setError(null);
    if (proof?.path) formData.set('proof_path', proof.path);
    startTransition(async () => {
      const r = await confirmAttendance(formData);
      if (r.error) {
        setError(r.error);
        return;
      }
      setOpen(false);
      setProof(null);
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
          setProof(null);
        }
      }}
    >
      {trigger && <Dialog.Trigger asChild>{trigger}</Dialog.Trigger>}
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-agsi-navy/50" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-50 w-full max-w-lg -translate-x-1/2 -translate-y-1/2 p-4 focus:outline-none"
          aria-describedby={undefined}
        >
          <form
            action={onSubmit}
            className="max-h-[90vh] space-y-4 overflow-y-auto rounded-xl border border-agsi-lightGray bg-white p-5 shadow-xl"
          >
            <input type="hidden" name="id" value={eventId} />

            <div>
              <Dialog.Title className="text-lg font-semibold text-agsi-navy">
                Confirm attendance
              </Dialog.Title>
              <p className="mt-1 text-xs text-agsi-darkGray">
                {eventName}
              </p>
            </div>

            <div className="grid gap-3">
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium text-agsi-darkGray">
                  Value gained (notes)
                </span>
                <Textarea
                  name="value_note"
                  rows={3}
                  placeholder="What came out of attending — connections, intel, leads…"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium text-agsi-darkGray">
                  Feedback
                </span>
                <Textarea
                  name="feedback"
                  rows={2}
                  placeholder="Worth attending next year? Quality, organisation, etc."
                />
              </label>
              <div>
                <span className="block text-xs font-medium text-agsi-darkGray">
                  Badge photo
                </span>
                <p className="mt-1 mb-2 text-xs2 text-agsi-darkGray">
                  Optional, but attaching one marks this attendance{' '}
                  <strong className="text-agsi-navy">Verified</strong>.
                </p>
                <EventProofUploader
                  memberId={memberId}
                  onChange={setProof}
                  disabled={pending}
                />
              </div>
            </div>

            {error && <p className="text-xs text-rag-red">{error}</p>}

            <div className="flex items-center justify-end gap-2">
              <Dialog.Close asChild>
                <Button type="button" size="sm" variant="ghost" disabled={pending}>
                  Cancel
                </Button>
              </Dialog.Close>
              <Button type="submit" size="sm" disabled={pending}>
                {pending ? 'Saving…' : 'Mark attended'}
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import * as Dialog from '@radix-ui/react-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { EVENT_TYPES, EVENT_TYPE_LABEL, type EventType } from '@/lib/zod/event';
import { createEvent, updateEvent } from '@/server/actions/events';
import {
  EventProofUploader,
  type UploadedProof,
} from '@/components/domain/EventProofUploader';

export type EventInitial = {
  id: string;
  event_name: string;
  event_date: string;
  event_type: EventType;
  website: string | null;
  value_note: string | null;
  feedback: string | null;
  proof_path?: string | null;
};

/**
 * Add / edit modal for the team event-attendance log. Used from:
 *   - The dashboard's "My events attended" card (mode='create')
 *   - The /events table row actions (mode='edit', for own rows + admin)
 *
 * This form is the *direct-log* path: the member attended the event
 * already and is recording it after the fact, optionally with a badge
 * photo. For declaring a future event use PlanEventDialog, and for
 * confirming a previously planned event use ConfirmAttendanceDialog.
 *
 * Submits to the createEvent / updateEvent server actions; member_id
 * is stamped server-side. The dialog closes + router.refresh()-es on
 * success so the parent re-renders from fresh data.
 */
export function EventLogForm({
  mode,
  initial,
  memberId,
  trigger,
  open: controlledOpen,
  onOpenChange,
}: {
  mode: 'create' | 'edit';
  initial?: EventInitial;
  /** Path prefix for any uploaded badge photo. */
  memberId: string;
  /** Element rendered inside Dialog.Trigger (uncontrolled usage). */
  trigger?: React.ReactNode;
  /** Controlled open state (parent owns visibility). */
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

  // Initial proof_path from edit mode flows in as a hidden input
  // unless the user replaces it via the uploader.
  const initialProofPath = initial?.proof_path ?? null;
  const effectiveProofPath = proof?.path ?? initialProofPath ?? '';

  async function onSubmit(formData: FormData) {
    setError(null);
    // Ensure the hidden proof_path field reflects either a fresh
    // upload or the original (in edit mode) — the EventProofUploader
    // only emits one when the user actually picks a file.
    if (effectiveProofPath) {
      formData.set('proof_path', effectiveProofPath);
    }
    startTransition(async () => {
      const r =
        mode === 'create' ? await createEvent(formData) : await updateEvent(formData);
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
            <Dialog.Title className="text-lg font-semibold text-agsi-navy">
              {mode === 'create' ? 'Log an event' : 'Edit event'}
            </Dialog.Title>
            {mode === 'edit' && initial && (
              <input type="hidden" name="id" value={initial.id} />
            )}

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="sm:col-span-2 flex flex-col gap-1">
                <span className="text-xs font-medium text-agsi-darkGray">
                  Event name <span className="text-rag-red">*</span>
                </span>
                <Input
                  name="event_name"
                  required
                  defaultValue={initial?.event_name ?? ''}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium text-agsi-darkGray">
                  Date <span className="text-rag-red">*</span>
                </span>
                <Input
                  name="event_date"
                  type="date"
                  required
                  defaultValue={initial?.event_date ?? ''}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium text-agsi-darkGray">
                  Type <span className="text-rag-red">*</span>
                </span>
                <Select
                  name="event_type"
                  required
                  defaultValue={initial?.event_type ?? 'conference'}
                >
                  {EVENT_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {EVENT_TYPE_LABEL[t]}
                    </option>
                  ))}
                </Select>
              </label>
              <label className="sm:col-span-2 flex flex-col gap-1">
                <span className="text-xs font-medium text-agsi-darkGray">
                  Website
                </span>
                <Input
                  name="website"
                  type="url"
                  placeholder="https://"
                  defaultValue={initial?.website ?? ''}
                />
              </label>
              <label className="sm:col-span-2 flex flex-col gap-1">
                <span className="text-xs font-medium text-agsi-darkGray">
                  Value gained (notes)
                </span>
                <Textarea
                  name="value_note"
                  rows={3}
                  placeholder="What came out of attending — connections, intel, leads…"
                  defaultValue={initial?.value_note ?? ''}
                />
              </label>
              <label className="sm:col-span-2 flex flex-col gap-1">
                <span className="text-xs font-medium text-agsi-darkGray">
                  Feedback
                </span>
                <Textarea
                  name="feedback"
                  rows={2}
                  placeholder="Worth attending next year? Quality, organisation, etc."
                  defaultValue={initial?.feedback ?? ''}
                />
              </label>
              <div className="sm:col-span-2">
                <span className="block text-xs font-medium text-agsi-darkGray">
                  Badge photo
                </span>
                <p className="mt-1 mb-2 text-xs2 text-agsi-darkGray">
                  Optional. Attaching one marks the event{' '}
                  <strong className="text-agsi-navy">Verified</strong>.
                </p>
                {initialProofPath && !proof && (
                  <p className="mb-2 text-xs2 text-agsi-darkGray">
                    Existing proof attached. Upload a new image to replace it.
                  </p>
                )}
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
                {pending
                  ? 'Saving…'
                  : mode === 'create'
                    ? 'Log event'
                    : 'Save'}
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

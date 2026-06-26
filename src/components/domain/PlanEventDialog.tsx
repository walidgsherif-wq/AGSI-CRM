'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import * as Dialog from '@radix-ui/react-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { EVENT_TYPES, EVENT_TYPE_LABEL } from '@/lib/zod/event';
import { createPlannedEvent } from '@/server/actions/events';

/**
 * "Plan event" modal — declare a future event you intend to attend.
 * Subset of the EventLogForm fields: just name / date / type / website.
 * Value gained, feedback, and the badge photo come later via the
 * ConfirmAttendanceDialog once the event has actually happened.
 */
export function PlanEventDialog({
  trigger,
  open: controlledOpen,
  onOpenChange,
}: {
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

  async function onSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const r = await createPlannedEvent(formData);
      if (r.error) {
        setError(r.error);
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setError(null);
      }}
    >
      {trigger && <Dialog.Trigger asChild>{trigger}</Dialog.Trigger>}
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-agsi-navy/50" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 p-4 focus:outline-none"
          aria-describedby={undefined}
        >
          <form
            action={onSubmit}
            className="max-h-[90vh] space-y-4 overflow-y-auto rounded-xl border border-agsi-lightGray bg-white p-5 shadow-xl"
          >
            <div>
              <Dialog.Title className="text-lg font-semibold text-agsi-navy">
                Plan an upcoming event
              </Dialog.Title>
              <p className="mt-1 text-xs text-agsi-darkGray">
                Add the event to your calendar so the team can see
                what&rsquo;s coming. Confirm attendance with a badge photo
                afterwards.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="sm:col-span-2 flex flex-col gap-1">
                <span className="text-xs font-medium text-agsi-darkGray">
                  Event name <span className="text-rag-red">*</span>
                </span>
                <Input name="event_name" required />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium text-agsi-darkGray">
                  Date <span className="text-rag-red">*</span>
                </span>
                <Input name="event_date" type="date" required />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium text-agsi-darkGray">
                  Type <span className="text-rag-red">*</span>
                </span>
                <Select name="event_type" required defaultValue="conference">
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
                <Input name="website" type="url" placeholder="https://" />
              </label>
            </div>

            {error && <p className="text-xs text-rag-red">{error}</p>}

            <div className="flex items-center justify-end gap-2">
              <Dialog.Close asChild>
                <Button type="button" size="sm" variant="ghost" disabled={pending}>
                  Cancel
                </Button>
              </Dialog.Close>
              <Button type="submit" size="sm" disabled={pending}>
                {pending ? 'Saving…' : 'Add to upcoming'}
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

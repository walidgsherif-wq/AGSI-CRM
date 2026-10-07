'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { EventLogForm } from '@/components/domain/EventLogForm';
import { ConfirmAttendanceDialog } from '@/components/domain/ConfirmAttendanceDialog';
import { deleteEvent } from '@/server/actions/events';
import type { MyEventRow } from './MyEventsCard';

export function MyEventsListActions({
  row,
  memberId,
}: {
  row: MyEventRow;
  memberId: string;
}) {
  const router = useRouter();
  const [editOpen, setEditOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function remove() {
    if (!window.confirm(`Delete "${row.event_name}"? This can't be undone.`)) {
      return;
    }
    startTransition(async () => {
      const r = await deleteEvent(row.id);
      if (r.error) {
        window.alert(r.error);
      } else {
        router.refresh();
      }
    });
  }

  return (
    <div className="flex flex-shrink-0 items-center gap-3">
      {row.status === 'planned' && (
        <button
          type="button"
          onClick={() => setConfirmOpen(true)}
          disabled={pending}
          className="text-xs font-medium text-agsi-accent hover:underline disabled:opacity-50"
        >
          Confirm attendance
        </button>
      )}
      <button
        type="button"
        onClick={() => setEditOpen(true)}
        disabled={pending}
        className="text-xs font-medium text-agsi-navy hover:underline disabled:opacity-50"
      >
        Edit
      </button>
      <button
        type="button"
        onClick={remove}
        disabled={pending}
        className="text-xs text-agsi-midGray hover:text-rag-red hover:underline disabled:opacity-50"
      >
        Delete
      </button>
      <EventLogForm
        mode="edit"
        initial={row}
        memberId={memberId}
        open={editOpen}
        onOpenChange={setEditOpen}
      />
      <ConfirmAttendanceDialog
        eventId={row.id}
        eventName={row.event_name}
        memberId={memberId}
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
      />
    </div>
  );
}

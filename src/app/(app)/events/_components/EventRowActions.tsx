'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { EventLogForm } from '@/components/domain/EventLogForm';
import { deleteEvent } from '@/server/actions/events';
import type { EventType } from '@/lib/zod/event';

type Row = {
  id: string;
  event_name: string;
  event_date: string;
  event_type: EventType;
  website: string | null;
  value_note: string | null;
  feedback: string | null;
};

export function EventRowActions({ row }: { row: Row }) {
  const router = useRouter();
  const [editOpen, setEditOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function remove() {
    if (!window.confirm(`Delete "${row.event_name}"? This can't be undone.`)) {
      return;
    }
    startTransition(async () => {
      const r = await deleteEvent(row.id);
      if (r.error) window.alert(r.error);
      else router.refresh();
    });
  }

  return (
    <div className="flex items-center gap-3">
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
        open={editOpen}
        onOpenChange={setEditOpen}
      />
    </div>
  );
}

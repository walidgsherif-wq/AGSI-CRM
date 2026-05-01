'use client';

import { Button } from '@/components/ui/button';

export function SaveBar({
  pending,
  dirty,
  status,
  onSave,
  saveLabel = 'Save',
}: {
  pending: boolean;
  dirty: boolean;
  status: { ok?: true; error?: string } | null;
  onSave: () => void;
  saveLabel?: string;
}) {
  return (
    <div className="mt-3 flex items-center gap-3">
      <Button type="button" size="sm" disabled={pending || !dirty} onClick={onSave}>
        {pending ? 'Saving…' : saveLabel}
      </Button>
      {status?.ok && <span className="text-xs text-agsi-green">Saved.</span>}
      {status?.error && <span className="text-xs text-rag-red">{status.error}</span>}
    </div>
  );
}

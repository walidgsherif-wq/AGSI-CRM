'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { createNote } from '@/server/actions/notes';

export function NoteForm({ companyId }: { companyId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [body, setBody] = useState('');
  const [pinned, setPinned] = useState(false);

  async function onSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const r = await createNote(formData);
      if (r.error) setError(r.error);
      else {
        setBody('');
        setPinned(false);
        router.refresh();
      }
    });
  }

  return (
    <form
      action={onSubmit}
      className="space-y-3 rounded-xl border border-agsi-lightGray bg-white p-4"
    >
      <input type="hidden" name="company_id" value={companyId} />
      <textarea
        name="body"
        required
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={3}
        placeholder="Internal note about this company…"
        className="w-full rounded-lg border border-agsi-midGray bg-white px-3 py-2 text-sm"
      />
      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" disabled={pending || !body.trim()}>
          {pending ? 'Saving…' : 'Add note'}
        </Button>
        <label className="inline-flex items-center gap-1.5 text-xs text-agsi-darkGray">
          <input
            type="checkbox"
            name="is_pinned"
            checked={pinned}
            onChange={(e) => setPinned(e.target.checked)}
            className="h-3.5 w-3.5 rounded"
          />
          Pin
        </label>
        {error && <p className="text-xs text-rag-red">{error}</p>}
      </div>
    </form>
  );
}

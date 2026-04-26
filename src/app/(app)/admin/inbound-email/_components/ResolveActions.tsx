'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { resolveUnmatchedEmail, discardUnmatchedEmail } from '@/server/actions/inbound-email';

type CompanyOption = { id: string; canonical_name: string };

export function ResolveActions({
  unmatchedId,
  companies,
}: {
  unmatchedId: string;
  companies: CompanyOption[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [companyId, setCompanyId] = useState('');
  const [note, setNote] = useState('');
  const [discardMode, setDiscardMode] = useState(false);

  function resolve() {
    if (!companyId) {
      setError('Pick a company.');
      return;
    }
    setError(null);
    startTransition(async () => {
      const r = await resolveUnmatchedEmail(unmatchedId, companyId, note.trim() || null);
      if (r.error) setError(r.error);
      else {
        setCompanyId('');
        setNote('');
        router.refresh();
      }
    });
  }

  function discard() {
    if (!note.trim()) {
      setError('Add a reason for discarding.');
      return;
    }
    setError(null);
    startTransition(async () => {
      const r = await discardUnmatchedEmail(unmatchedId, note);
      if (r.error) setError(r.error);
      else {
        setNote('');
        setDiscardMode(false);
        router.refresh();
      }
    });
  }

  return (
    <div className="space-y-2">
      {!discardMode && (
        <select
          value={companyId}
          onChange={(e) => setCompanyId(e.target.value)}
          disabled={pending}
          className="w-full rounded border border-agsi-midGray bg-white px-2 py-1 text-xs"
        >
          <option value="">— Pick a company —</option>
          {companies.map((c) => (
            <option key={c.id} value={c.id}>
              {c.canonical_name}
            </option>
          ))}
        </select>
      )}

      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder={discardMode ? 'Reason for discarding (required)…' : 'Optional note…'}
        rows={2}
        className="w-full rounded border border-agsi-midGray bg-white px-2 py-1 text-xs"
      />

      <div className="flex flex-wrap items-center gap-2">
        {!discardMode ? (
          <>
            <Button size="sm" disabled={pending} onClick={resolve}>
              {pending ? 'Working…' : 'Resolve & create engagement'}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={pending}
              onClick={() => setDiscardMode(true)}
            >
              Discard
            </Button>
          </>
        ) : (
          <>
            <Button size="sm" variant="danger" disabled={pending} onClick={discard}>
              {pending ? 'Working…' : 'Confirm discard'}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={pending}
              onClick={() => {
                setDiscardMode(false);
                setNote('');
                setError(null);
              }}
            >
              Cancel
            </Button>
          </>
        )}
        {error && <span className="text-xs text-rag-red">{error}</span>}
      </div>
    </div>
  );
}

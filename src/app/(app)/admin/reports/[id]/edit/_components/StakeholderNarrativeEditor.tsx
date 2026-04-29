'use client';

import { useState, useTransition } from 'react';
import { saveStakeholderNarrative } from '@/server/actions/leadership-reports';

export function StakeholderNarrativeEditor({
  rowId,
  initial,
  disabled,
}: {
  rowId: string;
  initial: string;
  disabled: boolean;
}) {
  const [value, setValue] = useState(initial);
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<{ ok?: true; error?: string } | null>(null);

  const dirty = value !== initial;

  return (
    <div>
      <textarea
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          setStatus(null);
        }}
        disabled={disabled}
        rows={2}
        placeholder={
          disabled
            ? '(narrative locked)'
            : 'One-line narrative for leadership ("Ongoing MOU discussion, expected to close in Q2"). Optional.'
        }
        className="w-full rounded-lg border border-agsi-midGray bg-white px-3 py-1.5 text-sm disabled:bg-agsi-offWhite"
      />
      {!disabled && dirty && (
        <div className="mt-1 flex items-center gap-2">
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              startTransition(async () => {
                const r = await saveStakeholderNarrative(rowId, value);
                if (r.error) setStatus({ error: r.error });
                else setStatus({ ok: true });
              });
            }}
            className="rounded bg-agsi-navy px-2 py-1 text-xs font-medium text-white hover:bg-agsi-blue disabled:opacity-50"
          >
            {pending ? 'Saving…' : 'Save'}
          </button>
          <button
            type="button"
            onClick={() => {
              setValue(initial);
              setStatus(null);
            }}
            className="text-xs text-agsi-darkGray hover:underline"
          >
            Cancel
          </button>
          {status?.error && <span className="text-xs text-rag-red">{status.error}</span>}
        </div>
      )}
      {!disabled && !dirty && status?.ok && (
        <p className="mt-1 text-xs text-agsi-green">Saved.</p>
      )}
    </div>
  );
}

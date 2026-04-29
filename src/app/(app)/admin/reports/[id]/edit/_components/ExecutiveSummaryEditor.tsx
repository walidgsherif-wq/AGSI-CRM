'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { saveExecutiveSummary } from '@/server/actions/leadership-reports';

export function ExecutiveSummaryEditor({
  reportId,
  initial,
  disabled,
}: {
  reportId: string;
  initial: string;
  disabled: boolean;
}) {
  const [value, setValue] = useState(initial);
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<{ ok?: true; error?: string } | null>(null);

  const dirty = value !== initial;

  return (
    <div className="space-y-2">
      <textarea
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          setStatus(null);
        }}
        disabled={disabled}
        rows={6}
        placeholder={
          disabled
            ? '(executive summary locked — finalised report)'
            : 'A few paragraphs of context for leadership: headline numbers, what shifted, what to ask about.'
        }
        className="w-full rounded-lg border border-agsi-midGray bg-white px-3 py-2 text-sm disabled:bg-agsi-offWhite"
      />
      {!disabled && (
        <div className="flex items-center gap-3">
          <Button
            type="button"
            size="sm"
            disabled={pending || !dirty}
            onClick={() => {
              startTransition(async () => {
                const r = await saveExecutiveSummary(reportId, value);
                if (r.error) setStatus({ error: r.error });
                else setStatus({ ok: true });
              });
            }}
          >
            {pending ? 'Saving…' : 'Save summary'}
          </Button>
          {status?.ok && <span className="text-xs text-agsi-green">Saved.</span>}
          {status?.error && <span className="text-xs text-rag-red">{status.error}</span>}
        </div>
      )}
    </div>
  );
}

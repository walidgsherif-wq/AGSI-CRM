'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { saveLeadershipFeedback } from '@/server/actions/leadership-reports';

export function LeadershipFeedbackEditor({
  reportId,
  initial,
}: {
  reportId: string;
  initial: string;
}) {
  const router = useRouter();
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
        rows={6}
        placeholder="Plain text — markdown is rendered on display. Whatever you write here is visible to admin and bd_head once saved."
        className="w-full rounded-lg border border-agsi-midGray bg-white px-3 py-2 text-sm"
      />
      <div className="flex items-center gap-3">
        <Button
          type="button"
          size="sm"
          disabled={pending || !dirty}
          onClick={() => {
            startTransition(async () => {
              const r = await saveLeadershipFeedback(reportId, value);
              if (r.error) setStatus({ error: r.error });
              else {
                setStatus({ ok: true });
                router.refresh();
              }
            });
          }}
        >
          {pending ? 'Saving…' : 'Save feedback'}
        </Button>
        {status?.ok && <span className="text-xs text-agsi-green">Saved.</span>}
        {status?.error && <span className="text-xs text-rag-red">{status.error}</span>}
      </div>
    </div>
  );
}

'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { ENGAGEMENT_TYPES, ENGAGEMENT_TYPE_LABEL } from '@/lib/zod/engagement';
import { createEngagement } from '@/server/actions/engagements';

type ProjectOption = { id: string; name: string };

export function EngagementForm({
  companyId,
  projects,
}: {
  companyId: string;
  projects: ProjectOption[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  async function onSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const r = await createEngagement(formData);
      if (r.error) setError(r.error);
      else {
        setOpen(false);
        router.refresh();
      }
    });
  }

  if (!open) {
    return (
      <Button onClick={() => setOpen(true)} size="sm">
        + Log engagement
      </Button>
    );
  }

  const today = new Date().toISOString().slice(0, 10);

  return (
    <form action={onSubmit} className="space-y-3 rounded-xl border border-agsi-lightGray bg-white p-4">
      <input type="hidden" name="company_id" value={companyId} />
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label className="block text-xs font-medium text-agsi-darkGray">Type</label>
          <select
            name="engagement_type"
            required
            defaultValue="meeting"
            className="mt-1 w-full rounded-lg border border-agsi-midGray bg-white px-3 py-2 text-sm"
          >
            {ENGAGEMENT_TYPES.map((t) => (
              <option key={t} value={t}>
                {ENGAGEMENT_TYPE_LABEL[t]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-agsi-darkGray">Date</label>
          <input
            name="engagement_date"
            type="date"
            required
            defaultValue={today}
            className="mt-1 w-full rounded-lg border border-agsi-midGray bg-white px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-agsi-darkGray">
            Linked project (optional)
          </label>
          <select
            name="project_id"
            defaultValue=""
            className="mt-1 w-full rounded-lg border border-agsi-midGray bg-white px-3 py-2 text-sm"
          >
            <option value="">— None —</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div>
        <label className="block text-xs font-medium text-agsi-darkGray">Summary</label>
        <textarea
          name="summary"
          required
          rows={3}
          placeholder="What happened? Outcome? Next steps?"
          className="mt-1 w-full rounded-lg border border-agsi-midGray bg-white px-3 py-2 text-sm"
        />
      </div>
      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? 'Saving…' : 'Save engagement'}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
          Cancel
        </Button>
        {error && <p className="text-xs text-rag-red">{error}</p>}
      </div>
    </form>
  );
}

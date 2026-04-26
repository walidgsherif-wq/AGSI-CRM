'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { triggerKpiRebuild } from '@/server/actions/kpi';

export function RebuildButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [info, setInfo] = useState<string | null>(null);

  function rebuild() {
    setInfo(null);
    startTransition(async () => {
      const r = await triggerKpiRebuild();
      if (r.error) setInfo(`Error: ${r.error}`);
      else setInfo(`Rebuilt: ${r.rows_written ?? 0} rows`);
      router.refresh();
    });
  }

  return (
    <div className="flex items-center gap-3">
      <Button size="sm" variant="outline" onClick={rebuild} disabled={pending}>
        {pending ? 'Rebuilding…' : 'Rebuild KPI now'}
      </Button>
      {info && <p className="text-xs text-agsi-darkGray">{info}</p>}
    </div>
  );
}

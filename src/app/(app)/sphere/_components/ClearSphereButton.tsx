'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { clearSphere } from '@/server/actions/sphere';

const NUM = new Intl.NumberFormat();

/**
 * Admin/bd_head-only reset. Confirms with the exact current count so
 * a big-fingered click can't quietly wipe hundreds of curated
 * targets. Empties `sphere_members` only — companies, proposals, and
 * everything else are untouched. After a clear, dashboard metrics
 * fall back to Full universe via Build B's empty-sphere guard.
 */
export function ClearSphereButton({ sphereCount }: { sphereCount: number }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onClick() {
    if (sphereCount === 0) return;
    if (
      !confirm(
        `Remove all ${NUM.format(sphereCount)} stakeholders from the sphere?\n\nThis empties membership only — companies, proposals, and history stay intact. Dashboard metrics will fall back to Full universe until you rebuild the sphere.`,
      )
    ) {
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await clearSphere();
      if ('error' in res) {
        setError(res.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        size="sm"
        variant="outline"
        onClick={onClick}
        disabled={pending || sphereCount === 0}
        title={
          sphereCount === 0
            ? 'Sphere is already empty'
            : `Remove all ${sphereCount} sphere members`
        }
      >
        <Trash2 aria-hidden className="mr-1 h-3.5 w-3.5" />
        Clear sphere
      </Button>
      {error && <span className="text-xxs text-rag-red">{error}</span>}
    </div>
  );
}

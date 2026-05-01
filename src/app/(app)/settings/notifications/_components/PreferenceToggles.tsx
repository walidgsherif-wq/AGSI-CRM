'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { setInAppPreference } from '@/server/actions/notifications';

export function PreferenceToggles({
  notificationType,
  inApp,
}: {
  notificationType: string;
  inApp: boolean;
}) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(inApp);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex flex-col items-center gap-1">
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        disabled={pending}
        onClick={() => {
          const next = !enabled;
          setEnabled(next);
          setError(null);
          startTransition(async () => {
            const r = await setInAppPreference(notificationType, next);
            if (r.error) {
              setEnabled(!next);
              setError(r.error);
            } else {
              router.refresh();
            }
          });
        }}
        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
          enabled ? 'bg-agsi-green' : 'bg-agsi-midGray'
        } ${pending ? 'opacity-60' : ''}`}
      >
        <span
          className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
            enabled ? 'translate-x-4' : 'translate-x-0.5'
          }`}
          aria-hidden
        />
      </button>
      {error && <span className="text-[10px] text-rag-red">{error}</span>}
    </div>
  );
}

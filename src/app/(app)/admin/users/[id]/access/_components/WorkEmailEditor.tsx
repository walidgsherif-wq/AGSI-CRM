'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { setUserWorkEmail } from '@/server/actions/users';

export function WorkEmailEditor({
  userId,
  currentValue,
}: {
  userId: string;
  currentValue: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [value, setValue] = useState(currentValue ?? '');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function save() {
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const r = await setUserWorkEmail(userId, value);
      if (r.error) {
        setError(r.error);
      } else {
        setSaved(true);
        router.refresh();
      }
    });
  }

  function clear() {
    setValue('');
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const r = await setUserWorkEmail(userId, null);
      if (r.error) setError(r.error);
      else {
        setSaved(true);
        router.refresh();
      }
    });
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="email"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setSaved(false);
          }}
          placeholder="alice@yourcompany.com"
          disabled={pending}
          className="max-w-sm"
        />
        <Button size="sm" onClick={save} disabled={pending}>
          {pending ? 'Saving…' : 'Save'}
        </Button>
        {currentValue && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={clear}
            disabled={pending}
          >
            Clear
          </Button>
        )}
        {saved && <span className="text-xs text-agsi-green">Saved.</span>}
        {error && <span className="text-xs text-rag-red">{error}</span>}
      </div>
      <p className="text-xs text-agsi-darkGray">
        Lets the inbound-email matcher recognise this user when they
        send or receive mail from a corporate / Outlook alias different
        from their sign-in address. Must be unique across the team.
      </p>
    </div>
  );
}

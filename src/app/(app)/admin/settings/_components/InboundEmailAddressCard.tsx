'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { updateInboundEmailAddress } from '@/server/actions/admin-settings';
import { SaveBar } from './SaveBar';

export function InboundEmailAddressCard({
  initialAddress,
}: {
  initialAddress: string;
}) {
  const router = useRouter();
  const [address, setAddress] = useState(initialAddress);
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<{ ok?: true; error?: string } | null>(null);
  const trimmed = address.trim();
  const dirty = trimmed !== initialAddress.trim();

  return (
    <Card>
      <CardHeader>
        <CardTitle>Inbound email</CardTitle>
        <CardDescription>
          Auto-log address surfaced on pipeline cold-card hints. Put it in{' '}
          <strong>Cc</strong> (not BCC) on real client emails — replies via
          Reply All then ride along on the thread, so both directions of every
          conversation get captured automatically. BCC drops out after one hop
          and loses the reply. The actual webhook URL is configured per
          provider in <code>supabase/APPLY-M9-EMAIL.md</code>; this setting
          is just the friendly address the team Cc&apos;s. Leave empty to keep
          the generic cold-card copy.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <label className="block text-xs font-medium text-agsi-darkGray">
          Address
        </label>
        <input
          type="email"
          value={address}
          onChange={(e) => {
            setAddress(e.target.value);
            setStatus(null);
          }}
          placeholder="crm@yourdomain.com"
          className="mt-1 w-72 rounded-lg border border-agsi-midGray bg-white px-3 py-1.5 text-sm"
        />
        <SaveBar
          pending={pending}
          dirty={dirty}
          status={status}
          onSave={() => {
            setStatus(null);
            startTransition(async () => {
              const r = await updateInboundEmailAddress(trimmed);
              if ('error' in r) setStatus({ error: r.error });
              else {
                setStatus({ ok: true });
                router.refresh();
              }
            });
          }}
        />
      </CardContent>
    </Card>
  );
}

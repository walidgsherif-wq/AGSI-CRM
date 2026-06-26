'use client';

import { useState } from 'react';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';

/**
 * "View proof" button for admin / leadership on the /events table.
 * Mirrors EvidenceLinks but for a single image in the event-proofs
 * bucket. RLS controls who can actually fetch — if a non-owner /
 * non-review role hits this, the signed-url call returns an error
 * and we surface it in an alert.
 */
export function EventProofLink({
  path,
  label = 'View proof',
}: {
  path: string;
  label?: string;
}) {
  const [pending, setPending] = useState(false);

  async function open() {
    setPending(true);
    const supabase = createSupabaseBrowserClient();
    const { data, error } = await supabase.storage
      .from('event-proofs')
      .createSignedUrl(path, 60);
    setPending(false);
    if (error || !data?.signedUrl) {
      alert(`Could not open: ${error?.message ?? 'unknown error'}`);
      return;
    }
    window.open(data.signedUrl, '_blank');
  }

  return (
    <button
      type="button"
      disabled={pending}
      onClick={open}
      className="text-xs text-agsi-accent hover:underline disabled:opacity-50"
    >
      {pending ? 'Opening…' : label}
    </button>
  );
}

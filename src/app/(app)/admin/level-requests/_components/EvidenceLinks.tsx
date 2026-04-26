'use client';

import { useState } from 'react';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';

export function EvidenceLinks({ paths }: { paths: string[] }) {
  const [pending, setPending] = useState<string | null>(null);

  async function open(path: string) {
    setPending(path);
    const supabase = createSupabaseBrowserClient();
    const { data, error } = await supabase.storage
      .from('evidence')
      .createSignedUrl(path, 60);
    setPending(null);
    if (error || !data?.signedUrl) {
      alert(`Could not open: ${error?.message ?? 'unknown error'}`);
      return;
    }
    window.open(data.signedUrl, '_blank');
  }

  if (paths.length === 0) {
    return <span className="text-xs italic text-agsi-darkGray">No files attached.</span>;
  }

  return (
    <ul className="space-y-1 text-xs">
      {paths.map((p) => {
        const name = p.split('/').pop() ?? p;
        return (
          <li key={p}>
            <button
              type="button"
              disabled={pending === p}
              onClick={() => open(p)}
              className="text-agsi-accent hover:underline disabled:opacity-50"
            >
              {pending === p ? 'Opening…' : name}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

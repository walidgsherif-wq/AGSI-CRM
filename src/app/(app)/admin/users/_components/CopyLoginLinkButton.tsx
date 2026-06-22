'use client';

import { useState } from 'react';

/**
 * Copies the canonical production sign-in URL to the clipboard so the
 * admin can send it privately (Slack / WhatsApp / SMS) to a freshly
 * added user. Under Google OAuth no link is emailed, so this is the
 * primary distribution channel.
 *
 * Base resolution order:
 *   1. NEXT_PUBLIC_SITE_URL when set to a non-localhost value
 *      (production / staging deploys configure this in Vercel).
 *   2. window.location.origin — fallback that works in any
 *      browser context including prod without the env var.
 *
 * Localhost is suppressed in (1) so we never leak a dev URL into a
 * shared invite, but the origin fallback in (2) still catches it for
 * local development where the user testing it knows what they're
 * looking at.
 */
export function CopyLoginLinkButton({
  variant = 'header',
}: {
  variant?: 'header' | 'inline';
}) {
  const [copied, setCopied] = useState(false);

  function onCopy() {
    const envBase = process.env.NEXT_PUBLIC_SITE_URL ?? '';
    const isLocal =
      envBase.startsWith('http://localhost') ||
      envBase.startsWith('http://127.0.0.1');
    const base =
      envBase && !isLocal
        ? envBase.replace(/\/+$/, '')
        : typeof window !== 'undefined'
          ? window.location.origin
          : '';
    if (!base) return;
    const link = `${base}/login`;
    void navigator.clipboard.writeText(link).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    });
  }

  if (variant === 'inline') {
    return (
      <button
        type="button"
        onClick={onCopy}
        className="rounded border border-agsi-midGray bg-white px-2 py-1 text-xs font-medium text-agsi-navy hover:bg-agsi-offWhite"
      >
        {copied ? 'Copied!' : 'Copy login link'}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onCopy}
      className="rounded-lg border border-agsi-midGray bg-white px-3 py-1.5 text-sm font-medium text-agsi-navy hover:bg-agsi-offWhite"
    >
      {copied ? 'Copied!' : 'Copy login link'}
    </button>
  );
}

'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import { Button } from '@/components/ui/button';

/**
 * Error boundary for the (app) route group. Renders when a server
 * component throws or a route handler returns 500. The default
 * Next.js 14 error page is bare; this gives users a clear message,
 * a Retry button, and a Dashboard link so they aren't stranded.
 *
 * The actual error is intentionally redacted in the UI in production
 * (Next.js mask) but logged to the browser console here for the
 * admin's dev-tools dive.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error('App route error:', error);
  }, [error]);

  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-rag-red/30 bg-rag-red/5 px-6 py-12 text-center">
      <div
        aria-hidden
        className="flex h-12 w-12 items-center justify-center rounded-full bg-rag-red/15 text-base font-semibold text-rag-red"
      >
        !
      </div>
      <p className="text-base font-semibold text-agsi-navy">
        Something broke loading this page
      </p>
      <p className="max-w-md text-sm text-agsi-darkGray">
        The server hit an error rendering this view. Try reloading the page; if
        the problem persists share the digest with the admin.
      </p>
      {error.digest && (
        <p className="font-mono text-[11px] text-agsi-darkGray">
          digest: {error.digest}
        </p>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" onClick={reset}>
          Try again
        </Button>
        <Link
          href="/dashboard"
          className="rounded-lg border border-agsi-midGray bg-white px-3 py-1.5 text-sm text-agsi-navy hover:bg-agsi-offWhite"
        >
          Go to dashboard
        </Link>
      </div>
    </div>
  );
}

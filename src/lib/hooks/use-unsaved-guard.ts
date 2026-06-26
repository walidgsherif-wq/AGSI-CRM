'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

type PendingNav = { path: string };

/**
 * Browser + in-app navigation guard for unsaved form state.
 *
 * While `isDirty` is true:
 *   - `beforeunload` registers a handler so the browser shows its
 *     native "Leave site?" prompt on tab close, refresh, back/forward,
 *     and URL-bar navigation. The browser controls that prompt's
 *     copy — we don't try to customise it.
 *   - A capture-phase `document` click listener intercepts clicks on
 *     `<a>` elements that would navigate within the same origin and
 *     are NOT in-page anchors, new-tab, mailto/tel, or download links.
 *     Those clicks are `preventDefault`'d and the destination is held
 *     in `pendingHref`. Consumers render a confirm dialog; on confirm
 *     the hook performs the in-app push, on cancel it discards.
 *
 * Caller is responsible for clearing `isDirty` on a successful submit
 * so the post-save router transition is silent.
 *
 * App Router has no public navigation-event API, so this MUST
 * intercept link clicks — a beforeunload-only solution would let
 * sidebar / breadcrumb clicks silently discard input.
 */
export function useUnsavedGuard(isDirty: boolean) {
  const router = useRouter();
  const [pending, setPending] = useState<PendingNav | null>(null);

  useEffect(() => {
    if (!isDirty) return;

    function onBeforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault();
      // Required for legacy browsers; modern browsers ignore the
      // string and display their own generic message.
      e.returnValue = '';
    }

    function onAnchorClick(e: MouseEvent) {
      if (e.defaultPrevented) return;
      if (e.button !== 0) return;
      // Modifier-clicks open in a new tab / window — current page
      // keeps state, so no need to intercept.
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const anchor = (e.target as HTMLElement | null)?.closest?.('a');
      if (!anchor) return;
      const href = anchor.getAttribute('href');
      if (!href) return;
      // Bypass: in-page anchors, mailto/tel, new tab, downloads.
      if (href.startsWith('#')) return;
      if (anchor.target === '_blank') return;
      if (anchor.hasAttribute('download')) return;
      if (/^(mailto:|tel:)/i.test(href)) return;
      // External origins fall through to beforeunload.
      let url: URL;
      try {
        url = new URL(href, window.location.origin);
      } catch {
        return;
      }
      if (url.origin !== window.location.origin) return;

      e.preventDefault();
      e.stopPropagation();
      setPending({ path: url.pathname + url.search + url.hash });
    }

    window.addEventListener('beforeunload', onBeforeUnload);
    // Capture-phase so we run before Next.js's Link click handler.
    document.addEventListener('click', onAnchorClick, true);

    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      document.removeEventListener('click', onAnchorClick, true);
    };
  }, [isDirty]);

  return {
    pendingHref: pending?.path ?? null,
    confirm: () => {
      if (!pending) return;
      const dest = pending.path;
      setPending(null);
      router.push(dest as never);
    },
    cancel: () => setPending(null),
  };
}

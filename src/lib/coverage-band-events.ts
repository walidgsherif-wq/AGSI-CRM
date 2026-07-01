'use client';

import type { ValueBand } from '@/types/coverage';

/**
 * Client-side event bus for "the coverage value-band just changed."
 * The CoverageRadarPanel and SegmentPenetrationPanel each hold their
 * own local band state so either can be used standalone; when they
 * sit side-by-side on the dashboard, we want a click on one panel's
 * filter to also move the other. Instead of hoisting state through
 * a wrapper component (which would force a prop-shape change on
 * CoverageRadarPanel), each panel fires on click + subscribes to
 * the event and updates its own state.
 *
 * Same pattern as src/lib/notifications-events.ts (PR #151). SSR-safe
 * — no-op on the server. Same-tab only; cross-user / cross-tab
 * realtime is out of scope.
 */

const EVENT_NAME = 'agsi:coverage-band-changed';

export function notifyBandChanged(band: ValueBand): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent<ValueBand>(EVENT_NAME, { detail: band }),
  );
}

export function subscribeBandChanged(
  callback: (band: ValueBand) => void,
): () => void {
  if (typeof window === 'undefined') return () => {};
  const handler = (e: Event) => {
    const detail = (e as CustomEvent<ValueBand>).detail;
    if (detail) callback(detail);
  };
  window.addEventListener(EVENT_NAME, handler);
  return () => window.removeEventListener(EVENT_NAME, handler);
}

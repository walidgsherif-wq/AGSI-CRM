'use client';

/**
 * Tiny client-side event bus for "the user's own unread count just
 * changed." The sidebar NotificationBell holds its count in local
 * state — any mutation outside the bell (the /notifications inbox
 * page, inline approve/reject in ReviewActions, etc.) has no way to
 * tell the bell to refresh via React state or `revalidatePath`. A
 * plain window CustomEvent is the smallest lever that closes that
 * gap: everyone who mutates unread state fires the event, the bell
 * subscribes and re-runs its summary fetch.
 *
 * Same-tab only. Cross-user / cross-tab realtime is deliberately
 * out of scope (see the brief).
 */

const EVENT_NAME = 'agsi:notifications-changed';

/**
 * Broadcast that the user's unread count just changed. Safe to call
 * from any client component (SSR-safe: no-op on the server).
 * Idempotent — firing twice in quick succession just triggers two
 * refreshes; the bell's fetch dedups via React state.
 */
export function notifyUnreadChanged(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(EVENT_NAME));
}

/**
 * Subscribe to unread-count-changed events. Returns a cleanup fn to
 * pass straight to a `useEffect` return.
 */
export function subscribeUnreadChanged(callback: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener(EVENT_NAME, callback);
  return () => window.removeEventListener(EVENT_NAME, callback);
}

'use client';

import { useEffect, useRef } from 'react';
import { markRead } from '@/server/actions/notifications';
import { notifyUnreadChanged } from '@/lib/notifications-events';

/**
 * Zero-render helper that clears the caller's unread mentions on
 * this page as their target comments scroll into view.
 *
 *   - Only the notifications passed in as `mentions` are cleared;
 *     other users' mentions and comments the user wasn't mentioned
 *     in are ignored.
 *   - Threshold 60% visible sustained for 500ms — fast scroll-through
 *     doesn't misfire, deliberate reading does.
 *   - Each notification fires markRead exactly once per mount; a
 *     re-observe after clearing is a no-op.
 *   - Fires notifyUnreadChanged() after each successful markRead so
 *     the sidebar badge AND the Discussion tab badge both re-fetch
 *     (both subscribe to the same bus).
 *
 * DOM contract: each comment renders as `id="comment-<uuid>"`
 * (CommentList already does this). MentionClearer looks up by id.
 */
export function MentionClearer({
  mentions,
}: {
  mentions: Array<{ notificationId: string; commentId: string }>;
}) {
  // Ref, not state — mutating this set must not cause re-renders.
  const clearedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (mentions.length === 0) return;

    // Map DOM element → { notificationId, timerId }. When an entry
    // enters the 60% threshold we start a 500ms timer; leaving before
    // it fires cancels it.
    const timers = new Map<Element, number>();

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const el = entry.target as HTMLElement;
          const nid = el.dataset.mentionNotificationId;
          if (!nid || clearedRef.current.has(nid)) continue;

          if (entry.isIntersecting && entry.intersectionRatio >= 0.6) {
            // Already scheduled — leave it alone.
            if (timers.has(el)) continue;
            const t = window.setTimeout(() => {
              timers.delete(el);
              // Race guard: this notification could have been cleared
              // by a peer observer (edit/reload) between the schedule
              // and now.
              if (clearedRef.current.has(nid)) return;
              clearedRef.current.add(nid);
              // Fire-and-forget: markRead runs on the server, then we
              // broadcast so the sidebar bell and the Discussion tab
              // badge both refetch their scoped counts. A failure
              // (offline, RLS blip) leaves the mention unread — the
              // observer stays armed until the next successful pass.
              void markRead(nid).then((res) => {
                if (res && 'error' in res) {
                  clearedRef.current.delete(nid);
                  return;
                }
                notifyUnreadChanged();
              });
              observer.unobserve(el);
            }, 500);
            timers.set(el, t);
          } else {
            const t = timers.get(el);
            if (t !== undefined) {
              window.clearTimeout(t);
              timers.delete(el);
            }
          }
        }
      },
      { threshold: [0, 0.6, 1] },
    );

    // Attach to each mentioned comment's rendered <li id="comment-…">.
    // If a comment is missing from the DOM (soft-deleted after the
    // notification, filtered by paging), the mention just stays
    // unread — no crash, no silent clear.
    for (const m of mentions) {
      const el = document.getElementById(`comment-${m.commentId}`);
      if (!el) continue;
      // Stash the notification id on the node so the observer can
      // recover it without another map lookup per callback.
      (el as HTMLElement).dataset.mentionNotificationId = m.notificationId;
      observer.observe(el);
    }

    return () => {
      for (const t of timers.values()) window.clearTimeout(t);
      timers.clear();
      observer.disconnect();
    };
  }, [mentions]);

  return null;
}

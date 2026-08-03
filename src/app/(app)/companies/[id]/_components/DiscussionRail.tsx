'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useSearchParams } from 'next/navigation';
import { MessageSquare, PanelRightClose, PanelRightOpen } from 'lucide-react';
import { CommentComposer, type ComposerParticipant } from '../discussion/_components/CommentComposer';
import { CommentList, type CommentRow } from '../discussion/_components/CommentList';
import { MentionClearer } from '../discussion/_components/MentionClearer';
import { subscribeUnreadChanged } from '@/lib/notifications-events';
import { getUnreadMentionCountForCompany } from '@/server/actions/company-mentions';

const MIN_WIDTH_PCT = 22;
const MAX_WIDTH_PCT = 45;
const DEFAULT_WIDTH_PCT = 32;
const NARROW_VIEWPORT_PX = 1024;

type PersistedState = {
  widthPct: number;
  collapsed: boolean;
};

/**
 * Storage key is scoped per user so a shared browser doesn't leak
 * one teammate's collapsed/expanded preference into another's.
 * Missing / malformed data falls back to the defaults + the narrow-
 * viewport heuristic (default collapsed <1024px).
 */
function storageKey(userId: string) {
  return `agsi:discussion-rail:${userId}`;
}

function readPersisted(userId: string): PersistedState | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(storageKey(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PersistedState>;
    const widthPct = clampWidth(
      typeof parsed.widthPct === 'number' ? parsed.widthPct : DEFAULT_WIDTH_PCT,
    );
    const collapsed = typeof parsed.collapsed === 'boolean' ? parsed.collapsed : false;
    return { widthPct, collapsed };
  } catch {
    return null;
  }
}

function writePersisted(userId: string, state: PersistedState) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(storageKey(userId), JSON.stringify(state));
  } catch {
    // Quota / private-mode — silently ignore, the state stays in
    // memory for this session.
  }
}

function clampWidth(pct: number): number {
  if (!Number.isFinite(pct)) return DEFAULT_WIDTH_PCT;
  return Math.max(MIN_WIDTH_PCT, Math.min(MAX_WIDTH_PCT, pct));
}

/**
 * Persistent right-hand rail — reuses the existing thread pieces
 * (composer / list / mention-clearer) verbatim. Only placement +
 * chrome are new. Data is loaded in the company layout and passed
 * in as props; the rail itself is data-agnostic.
 */
export function DiscussionRail({
  companyId,
  currentUserId,
  canPost,
  isAdmin,
  initialComments,
  initialParticipants,
  initialUnreadMentions,
  initialUnreadCount,
}: {
  companyId: string;
  currentUserId: string;
  canPost: boolean;
  isAdmin: boolean;
  initialComments: CommentRow[];
  initialParticipants: ComposerParticipant[];
  initialUnreadMentions: Array<{ notificationId: string; commentId: string }>;
  initialUnreadCount: number;
}) {
  const searchParams = useSearchParams();
  const targetCommentId = searchParams.get('comment');

  // Hydration-safe defaults: SSR always renders expanded at 32% so
  // the server + client match. On mount we swap to the persisted /
  // narrow-viewport values in a single effect, avoiding a flash by
  // gating the visible chrome behind `hydrated`.
  const [widthPct, setWidthPct] = useState(DEFAULT_WIDTH_PCT);
  const [collapsed, setCollapsed] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [unreadCount, setUnreadCount] = useState(initialUnreadCount);

  useEffect(() => {
    const persisted = readPersisted(currentUserId);
    if (persisted) {
      setWidthPct(persisted.widthPct);
      setCollapsed(persisted.collapsed);
    } else if (
      typeof window !== 'undefined' &&
      window.innerWidth < NARROW_VIEWPORT_PX
    ) {
      // No preference yet + laptop/tablet-narrow — start collapsed so
      // the data-heavy tabs aren't crushed.
      setCollapsed(true);
    }
    setHydrated(true);
  }, [currentUserId]);

  // Persist. Runs after every state change, but only once hydration
  // is complete — otherwise the SSR defaults would overwrite the
  // user's saved preference on first paint.
  useEffect(() => {
    if (!hydrated) return;
    writePersisted(currentUserId, { widthPct, collapsed });
  }, [hydrated, currentUserId, widthPct, collapsed]);

  // Bump the collapsed-strip badge whenever any callsite fires the
  // notifications bus — same channel the sidebar bell listens to,
  // same channel MentionClearer's post-scroll markRead triggers.
  useEffect(() => {
    return subscribeUnreadChanged(() => {
      void getUnreadMentionCountForCompany(companyId)
        .then((n) => setUnreadCount(n))
        .catch(() => {
          // RLS/auth blip — leave the count as-is; next event reconciles.
        });
    });
  }, [companyId]);

  // Arriving via a mention deep-link (?comment=<id>) must open the
  // rail so the scroll + highlight fires. Only auto-expand — never
  // auto-collapse — so it respects the user's manual state otherwise.
  useEffect(() => {
    if (!hydrated || !targetCommentId) return;
    if (collapsed) setCollapsed(false);
    // Depending on the user's intent flag `collapsed` we could also
    // scroll here, but CommentList already handles scrollIntoView on
    // mount for its own targetCommentId prop.
  }, [hydrated, targetCommentId, collapsed]);

  // Drag-resize. Captures the mousedown x + starting width, then
  // watches the document until mouseup. Percentage math is against
  // the flex parent (the layout row), so a window resize doesn't
  // require rescaling — the same pct just applies to a new width.
  const dragStartRef = useRef<{ x: number; startPct: number } | null>(null);
  const asideRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    function onMove(e: MouseEvent) {
      const start = dragStartRef.current;
      const aside = asideRef.current;
      if (!start || !aside || !aside.parentElement) return;
      const parentWidth = aside.parentElement.clientWidth;
      if (parentWidth === 0) return;
      const dxPct = ((start.x - e.clientX) / parentWidth) * 100;
      setWidthPct(clampWidth(start.startPct + dxPct));
    }
    function onUp() {
      if (!dragStartRef.current) return;
      dragStartRef.current = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
  }, []);

  function onHandleMouseDown(e: React.MouseEvent) {
    dragStartRef.current = { x: e.clientX, startPct: widthPct };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    e.preventDefault();
  }

  // Ref for MentionClearer's IntersectionObserver root — the rail
  // scrolls internally, so the observer must anchor to this element,
  // not the viewport, or scroll events inside the rail won't fire.
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Stable reference: MentionClearer resets its observer whenever
  // `mentions` changes identity. Memoise so a parent re-render with
  // the same data doesn't churn.
  const memoisedMentions = useMemo(
    () => initialUnreadMentions,
    // Include the length + a fingerprint so newly-arrived mentions
    // (via router.refresh after a peer posts) still rebuild the set.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [initialUnreadMentions.map((m) => m.notificationId).join(',')],
  );

  if (collapsed) {
    return (
      <aside
        aria-label="Discussion (collapsed)"
        style={{ width: 44, flex: '0 0 44px' }}
        className="sticky top-4 self-start"
      >
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          aria-expanded={false}
          aria-controls="discussion-rail-panel"
          className="flex h-[calc(100vh-6rem)] w-full flex-col items-center gap-3 rounded-xl border border-agsi-lightGray bg-white py-3 shadow-sm transition-colors hover:bg-agsi-offWhite/60"
          title="Expand discussion"
        >
          <MessageSquare aria-hidden className="h-5 w-5 text-agsi-navy" />
          {unreadCount > 0 && (
            <span
              aria-label={`${unreadCount} unread mention${unreadCount === 1 ? '' : 's'}`}
              className="inline-flex min-w-[1.5rem] items-center justify-center rounded-full bg-agsi-accent px-1.5 py-0.5 text-xxs font-semibold text-white"
            >
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
          <span className="mt-1 [writing-mode:vertical-rl] text-xxs font-semibold uppercase tracking-wider text-agsi-darkGray">
            Discussion
          </span>
        </button>
      </aside>
    );
  }

  return (
    <aside
      ref={asideRef}
      id="discussion-rail-panel"
      aria-label="Discussion"
      style={{ width: `${widthPct}%`, flex: `0 0 ${widthPct}%` }}
      className="sticky top-4 self-start"
    >
      <div className="relative flex h-[calc(100vh-6rem)] flex-col rounded-xl border border-agsi-lightGray bg-white shadow-sm">
        {/* Left-edge drag handle. Positioned absolutely so it doesn't
            take flex space; the visual is a hairline that fattens on
            hover to advertise interactivity. */}
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize discussion"
          onMouseDown={onHandleMouseDown}
          className="absolute inset-y-0 -left-1 z-10 w-2 cursor-col-resize"
        >
          <div className="mx-auto h-full w-px bg-agsi-lightGray transition-colors group-hover:bg-agsi-navy/40 hover:bg-agsi-navy/40" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between border-b border-agsi-lightGray px-3 py-2">
          <div className="flex items-center gap-2">
            <MessageSquare aria-hidden className="h-4 w-4 text-agsi-navy" />
            <span className="text-sm font-semibold text-agsi-navy">
              Discussion
            </span>
            {unreadCount > 0 && (
              <span
                aria-label={`${unreadCount} unread mention${unreadCount === 1 ? '' : 's'}`}
                className="inline-flex min-w-[1.25rem] items-center justify-center rounded-full bg-agsi-accent px-1.5 text-xxs font-semibold leading-4 text-white"
              >
                {unreadCount > 99 ? '99+' : unreadCount}
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={() => setCollapsed(true)}
            aria-label="Collapse discussion"
            aria-expanded={true}
            aria-controls="discussion-rail-panel"
            className="rounded p-1 text-agsi-darkGray transition-colors hover:bg-agsi-offWhite hover:text-agsi-navy"
            title="Collapse"
          >
            <PanelRightClose aria-hidden className="h-4 w-4" />
          </button>
        </div>

        {/* Body — scrolls independently of the page. Composer floats
            at the top so it's always reachable without scrolling to
            the bottom of a long thread. */}
        <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-3">
          {canPost && (
            <CommentComposer
              companyId={companyId}
              participants={initialParticipants}
            />
          )}
          {initialComments.length === 0 ? (
            <p className="rounded border border-dashed border-agsi-lightGray p-4 text-xs italic text-agsi-darkGray">
              No comments yet — start the thread above.
            </p>
          ) : (
            <div className="rounded-lg border border-agsi-lightGray">
              <CommentList
                companyId={companyId}
                comments={initialComments}
                currentUserId={currentUserId}
                isAdmin={isAdmin}
                targetCommentId={targetCommentId}
              />
            </div>
          )}
        </div>

        {memoisedMentions.length > 0 && (
          <MentionClearer mentions={memoisedMentions} rootRef={scrollRef} />
        )}
      </div>
    </aside>
  );
}

/**
 * Exported so the layout doesn't need to know the icon's origin — a
 * placeholder chip rendered for leadership (no rail, single-column).
 * Currently unused; kept for consistency if a future role gets a
 * different treatment.
 */
export function DiscussionRailIcon() {
  return <PanelRightOpen aria-hidden className="h-4 w-4" />;
}

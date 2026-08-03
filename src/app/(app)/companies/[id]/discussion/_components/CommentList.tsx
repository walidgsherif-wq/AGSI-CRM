'use client';

import { useEffect, useRef, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { CommentActions } from './CommentActions';

export type MentionParticipant = {
  id: string;
  full_name: string;
  is_active: boolean;
};

export type CommentRow = {
  id: string;
  author_id: string | null;
  author_name: string | null;
  body: string;
  created_at: string;
  edited_at: string | null;
  deleted_at: string | null;
  mentions: MentionParticipant[];
};

/**
 * Renders the comment timeline. Uses the mentions[] rows from the
 * server (source of truth) to highlight @Name spans in the body —
 * we don't re-parse to look for '@' since the composer may have
 * inserted names with spaces / punctuation, and using the ids
 * guarantees the highlight matches the notification recipients.
 *
 * targetCommentId: comes from ?comment=<uuid> on a mention deep-link.
 * The matching row is scrolled into view + briefly ring-highlighted.
 */
export function CommentList({
  companyId,
  comments,
  currentUserId,
  isAdmin,
  targetCommentId,
}: {
  companyId: string;
  comments: CommentRow[];
  currentUserId: string;
  isAdmin: boolean;
  targetCommentId: string | null;
}) {
  const targetRef = useRef<HTMLLIElement | null>(null);
  const [flashOn, setFlashOn] = useState(true);

  useEffect(() => {
    if (!targetCommentId || !targetRef.current) return;
    targetRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setFlashOn(true);
    const t = window.setTimeout(() => setFlashOn(false), 2400);
    return () => window.clearTimeout(t);
  }, [targetCommentId]);

  return (
    <ul className="divide-y divide-agsi-lightGray">
      {comments.map((c) => {
        const isTarget = c.id === targetCommentId;
        const isAuthor = c.author_id === currentUserId;
        const canEdit = !c.deleted_at && isAuthor;
        const canDelete = !c.deleted_at && (isAuthor || isAdmin);
        return (
          <li
            key={c.id}
            id={`comment-${c.id}`}
            ref={isTarget ? targetRef : undefined}
            className={`px-4 py-3 transition-colors ${
              isTarget && flashOn
                ? 'bg-agsi-navy/5 ring-2 ring-agsi-accent/60'
                : ''
            }`}
          >
            {c.deleted_at ? (
              <TombstoneRow row={c} />
            ) : (
              <LiveCommentRow
                row={c}
                canEdit={canEdit}
                canDelete={canDelete}
                companyId={companyId}
              />
            )}
          </li>
        );
      })}
    </ul>
  );
}

function LiveCommentRow({
  row,
  canEdit,
  canDelete,
  companyId,
}: {
  row: CommentRow;
  canEdit: boolean;
  canDelete: boolean;
  companyId: string;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2 text-xs text-agsi-darkGray">
          <span className="font-medium text-agsi-navy">
            {row.author_name ?? 'Deleted user'}
          </span>
          <span>·</span>
          <time dateTime={row.created_at}>
            {new Date(row.created_at).toLocaleString()}
          </time>
          {row.edited_at && (
            <span className="italic text-agsi-midGray">(edited)</span>
          )}
        </div>
        <div className="mt-1 whitespace-pre-wrap break-words text-sm text-agsi-navy">
          {renderBodyWithMentions(row.body, row.mentions)}
        </div>
      </div>
      <CommentActions
        commentId={row.id}
        companyId={companyId}
        body={row.body}
        canEdit={canEdit}
        canDelete={canDelete}
      />
    </div>
  );
}

function TombstoneRow({ row }: { row: CommentRow }) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs italic text-agsi-darkGray">
      <Badge variant="neutral">Removed</Badge>
      <span>
        Comment by {row.author_name ?? 'unknown'} was removed on{' '}
        {row.deleted_at ? new Date(row.deleted_at).toLocaleString() : 'unknown date'}.
      </span>
    </div>
  );
}

/**
 * Splits body into text runs + mention chips using the recorded
 * mentions[] rows. Matches "@FullName" tokens greedily (longest
 * name first) so "@Anna Karen" doesn't get shadowed by "@Anna".
 * Anything not matched renders as plain text; the highlight is
 * strictly driven by the notification recipient list, not by @-parsing.
 */
function renderBodyWithMentions(body: string, mentions: MentionParticipant[]) {
  if (mentions.length === 0) return body;
  const tokens = [...mentions]
    .map((m) => ({ mention: m, token: `@${m.full_name}` }))
    .sort((a, b) => b.token.length - a.token.length);

  const parts: Array<
    | { kind: 'text'; text: string }
    | { kind: 'mention'; mention: MentionParticipant; key: string }
  > = [];

  let i = 0;
  let occurrence = 0;
  while (i < body.length) {
    let matched: { token: string; mention: MentionParticipant } | null = null;
    for (const t of tokens) {
      if (body.startsWith(t.token, i)) {
        matched = t;
        break;
      }
    }
    if (matched) {
      parts.push({
        kind: 'mention',
        mention: matched.mention,
        key: `${matched.mention.id}:${occurrence++}`,
      });
      i += matched.token.length;
    } else {
      // Consume text up to the next '@' (or end).
      const nextAt = body.indexOf('@', i + 1);
      const end = nextAt === -1 ? body.length : nextAt;
      parts.push({ kind: 'text', text: body.slice(i, end) });
      i = end;
    }
  }

  return parts.map((p, idx) =>
    p.kind === 'text' ? (
      <span key={idx}>{p.text}</span>
    ) : (
      <span
        key={p.key}
        title={
          p.mention.is_active
            ? `Mentioned: ${p.mention.full_name}`
            : `${p.mention.full_name} (deactivated)`
        }
        className={`rounded px-1 text-agsi-navy ${
          p.mention.is_active
            ? 'bg-agsi-accent/10 font-medium'
            : 'bg-agsi-lightGray/60 line-through'
        }`}
      >
        @{p.mention.full_name}
      </span>
    ),
  );
}

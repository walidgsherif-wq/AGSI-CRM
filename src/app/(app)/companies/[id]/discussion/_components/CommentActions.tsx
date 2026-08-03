'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import {
  deleteCompanyComment,
  editCompanyComment,
} from '@/server/actions/company-comments';

/**
 * Inline edit / delete actions on a single comment row. Edit shows a
 * mini textarea in-place; save calls the RPC. Delete is a soft-delete
 * confirmed via native confirm() — the tombstone shows immediately
 * after router.refresh().
 *
 * Editing does NOT re-notify mentions (MVP; RPC enforces the same
 * rule server-side by only touching body + edited_at).
 */
export function CommentActions({
  commentId,
  companyId,
  body,
  canEdit,
  canDelete,
}: {
  commentId: string;
  companyId: string;
  body: string;
  canEdit: boolean;
  canDelete: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(body);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // "Create task" is always shown on live comments — anyone who can
  // see the discussion can spawn a follow-up. Edit/Delete are still
  // gated by canEdit/canDelete.
  const anyAction = canEdit || canDelete || true;
  if (!anyAction) return null;

  function saveEdit() {
    setError(null);
    if (!draft.trim()) return;
    startTransition(async () => {
      const res = await editCompanyComment({
        id: commentId,
        body: draft,
        company_id: companyId,
      });
      if ('error' in res) {
        setError(res.error);
        return;
      }
      setEditing(false);
      router.refresh();
    });
  }

  function doDelete() {
    if (!confirm('Delete this comment? It will be hidden but kept for audit.')) {
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await deleteCompanyComment(commentId, companyId);
      if ('error' in res) setError(res.error);
      else router.refresh();
    });
  }

  if (editing) {
    return (
      <div className="w-full space-y-2 sm:w-96">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={3}
          disabled={pending}
          className="w-full rounded-md border border-agsi-midGray bg-white p-2 text-sm text-agsi-navy outline-none focus:border-agsi-navy"
        />
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={saveEdit} disabled={pending || !draft.trim()}>
            {pending ? 'Saving…' : 'Save'}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              setEditing(false);
              setDraft(body);
              setError(null);
            }}
            disabled={pending}
          >
            Cancel
          </Button>
          {error && <span className="text-xxs text-rag-red">{error}</span>}
        </div>
      </div>
    );
  }

  return (
    <div className="flex shrink-0 items-center gap-1">
      <Link
        href={
          `/companies/${companyId}/tasks?from_comment=${commentId}` as never
        }
        title="Create a follow-up task from this comment"
        className="rounded px-2 py-1 text-xxs text-agsi-darkGray hover:bg-agsi-lightGray/40 hover:text-agsi-navy"
      >
        Create task
      </Link>
      {canEdit && (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="rounded px-2 py-1 text-xxs text-agsi-darkGray hover:bg-agsi-lightGray/40 hover:text-agsi-navy"
        >
          Edit
        </button>
      )}
      {canDelete && (
        <button
          type="button"
          onClick={doDelete}
          disabled={pending}
          className="rounded px-2 py-1 text-xxs text-rag-red hover:bg-rag-red/10 disabled:opacity-50"
        >
          {pending ? '…' : 'Delete'}
        </button>
      )}
      {error && <span className="ml-2 text-xxs text-rag-red">{error}</span>}
    </div>
  );
}

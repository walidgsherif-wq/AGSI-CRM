'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { postCompanyComment } from '@/server/actions/company-comments';

export type ComposerParticipant = {
  id: string;
  full_name: string;
  role: string;
};

/**
 * Textarea + @-mention picker. Tracks mentions structurally: when the
 * user picks a suggestion we insert "@Name " into the text AND record
 * the (offset, id, name) in a local mentions[] list. On submit the id
 * list is passed to the server action. Duplicate mentions of the same
 * person are collapsed by the RPC — the composer allows re-mentioning
 * to make the flow feel natural.
 *
 * The mention token bookkeeping is best-effort: if the user hand-edits
 * an @Name span so it no longer starts with the recorded offset, we
 * drop the mention id (it wouldn't render as a highlight anyway).
 */
export function CommentComposer({
  companyId,
  participants,
}: {
  companyId: string;
  participants: ComposerParticipant[];
}) {
  const router = useRouter();
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [body, setBody] = useState('');
  const [mentions, setMentions] = useState<
    Array<{ id: string; name: string; offset: number }>
  >([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerAnchor, setPickerAnchor] = useState<number | null>(null); // caret offset of the '@'
  const [pickerQuery, setPickerQuery] = useState('');
  const [pickerIndex, setPickerIndex] = useState(0);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const suggestions = pickerOpen
    ? participants
        .filter((p) =>
          p.full_name.toLowerCase().includes(pickerQuery.toLowerCase()),
        )
        .slice(0, 6)
    : [];

  // Re-derive the picker state from the raw body + caret every time
  // the text changes. The last `@word` (no spaces after @, caret at
  // end of the word) opens the picker.
  function refreshPickerState(nextBody: string, caret: number) {
    // Look back from the caret for the nearest '@' unbroken by whitespace.
    let i = caret - 1;
    while (i >= 0 && /\S/.test(nextBody[i])) {
      if (nextBody[i] === '@') {
        // Only open the picker if the '@' is at start of string or
        // preceded by whitespace — avoids opening on emails.
        if (i === 0 || /\s/.test(nextBody[i - 1])) {
          setPickerOpen(true);
          setPickerAnchor(i);
          setPickerQuery(nextBody.slice(i + 1, caret));
          setPickerIndex(0);
          return;
        }
        break;
      }
      i--;
    }
    setPickerOpen(false);
    setPickerAnchor(null);
    setPickerQuery('');
  }

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const next = e.target.value;
    setBody(next);
    // Reconcile stored mention offsets: drop any whose recorded token
    // no longer matches the text at that offset.
    setMentions((prev) =>
      prev.filter((m) => {
        const token = `@${m.name}`;
        return next.slice(m.offset, m.offset + token.length) === token;
      }),
    );
    const caret = e.target.selectionStart ?? next.length;
    refreshPickerState(next, caret);
  }

  function insertMention(p: ComposerParticipant) {
    if (pickerAnchor === null || !textareaRef.current) return;
    const caret = textareaRef.current.selectionStart ?? body.length;
    // Replace "@<query>" (from anchor to caret) with "@FullName "
    const before = body.slice(0, pickerAnchor);
    const after = body.slice(caret);
    const token = `@${p.full_name}`;
    const next = `${before}${token} ${after}`;
    const newCaret = before.length + token.length + 1;

    setBody(next);
    setMentions((prev) => {
      // Shift existing mention offsets past the anchor to reflect the
      // (possibly longer) inserted token, then push this one.
      const oldSpanLen = caret - pickerAnchor; // "@query"
      const delta = token.length + 1 - oldSpanLen;
      const shifted = prev.map((m) =>
        m.offset >= pickerAnchor ? { ...m, offset: m.offset + delta } : m,
      );
      // Dedup: keep the earliest occurrence per profile id — the RPC
      // dedups too, but showing one row per mention keeps the highlight
      // logic simple.
      const withNew = [
        ...shifted,
        { id: p.id, name: p.full_name, offset: pickerAnchor },
      ];
      const seen = new Set<string>();
      return withNew
        .sort((a, b) => a.offset - b.offset)
        .filter((m) => {
          if (seen.has(m.id)) return false;
          seen.add(m.id);
          return true;
        });
    });
    setPickerOpen(false);
    setPickerAnchor(null);
    setPickerQuery('');

    // Restore focus + caret AFTER React re-renders.
    requestAnimationFrame(() => {
      const ta = textareaRef.current;
      if (!ta) return;
      ta.focus();
      ta.setSelectionRange(newCaret, newCaret);
    });
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (!pickerOpen || suggestions.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setPickerIndex((i) => Math.min(i + 1, suggestions.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setPickerIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      insertMention(suggestions[pickerIndex]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setPickerOpen(false);
    }
  }

  useEffect(() => {
    if (pickerIndex >= suggestions.length) setPickerIndex(0);
  }, [suggestions.length, pickerIndex]);

  async function submit() {
    if (!body.trim()) return;
    setError(null);
    const validMentions = mentions.filter((m) => {
      const token = `@${m.name}`;
      return body.slice(m.offset, m.offset + token.length) === token;
    });
    const uniqueIds = Array.from(new Set(validMentions.map((m) => m.id)));
    startTransition(async () => {
      const res = await postCompanyComment({
        company_id: companyId,
        body,
        mentioned_ids: uniqueIds,
      });
      if ('error' in res) {
        setError(res.error);
        return;
      }
      setBody('');
      setMentions([]);
      setPickerOpen(false);
      router.refresh();
    });
  }

  return (
    <div className="relative rounded-xl border border-agsi-lightGray bg-white p-4">
      <label
        htmlFor="comment-body"
        className="mb-2 block text-xs font-medium uppercase tracking-wide text-agsi-darkGray"
      >
        New comment
      </label>
      <textarea
        id="comment-body"
        ref={textareaRef}
        value={body}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        rows={3}
        placeholder="Share an update or type @ to mention a teammate…"
        className="min-h-[72px] w-full rounded-md border border-agsi-midGray bg-white p-2 text-sm text-agsi-navy outline-none focus:border-agsi-navy"
        disabled={pending}
      />

      {pickerOpen && suggestions.length > 0 && (
        <div className="absolute left-4 right-4 z-10 mt-1 max-h-60 overflow-y-auto rounded-md border border-agsi-lightGray bg-white shadow-md">
          <ul role="listbox" aria-label="Mention a teammate">
            {suggestions.map((s, idx) => (
              <li
                key={s.id}
                role="option"
                aria-selected={idx === pickerIndex}
                onMouseDown={(e) => {
                  // mousedown so the textarea keeps focus semantics.
                  e.preventDefault();
                  insertMention(s);
                }}
                onMouseEnter={() => setPickerIndex(idx)}
                className={`flex cursor-pointer items-center justify-between px-3 py-1.5 text-xs ${
                  idx === pickerIndex
                    ? 'bg-agsi-navy/5 text-agsi-navy'
                    : 'text-agsi-navy hover:bg-agsi-lightGray/30'
                }`}
              >
                <span>{s.full_name}</span>
                <span className="text-xxs text-agsi-darkGray">{s.role}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-3 flex items-center gap-3">
        <Button
          type="button"
          size="sm"
          onClick={submit}
          disabled={pending || !body.trim()}
        >
          {pending ? 'Posting…' : 'Post comment'}
        </Button>
        {mentions.length > 0 && (
          <span className="text-xxs text-agsi-darkGray">
            {mentions.length} mention{mentions.length === 1 ? '' : 's'} — they&apos;ll be notified
          </span>
        )}
        {error && <p className="text-xs text-rag-red">{error}</p>}
      </div>
    </div>
  );
}

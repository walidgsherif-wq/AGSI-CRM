import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { serverComponentCookies } from '@/lib/supabase/cookie-adapter';
import { getCurrentUser } from '@/lib/auth/get-user';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { CommentComposer } from './_components/CommentComposer';
import {
  CommentList,
  type CommentRow,
  type MentionParticipant,
} from './_components/CommentList';
import { MentionClearer } from './_components/MentionClearer';
import { listUnreadMentionsForCompany } from '@/server/actions/company-mentions';

export const dynamic = 'force-dynamic';

type RawCommentRow = {
  id: string;
  company_id: string;
  author_id: string | null;
  body: string;
  created_at: string;
  edited_at: string | null;
  deleted_at: string | null;
  author: { full_name: string } | null;
};

type RawMentionRow = {
  comment_id: string;
  mentioned_profile_id: string;
  profile: { full_name: string; is_active: boolean } | null;
};

export default async function CompanyDiscussionTab({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { comment?: string };
}) {
  const user = await getCurrentUser();

  // Notes-style role gate — leadership never sees the internal thread.
  if (user.role === 'leadership') {
    return (
      <Card>
        <CardContent className="p-6 text-sm text-agsi-darkGray">
          Discussion is a BD-team channel — not visible to leadership.
        </CardContent>
      </Card>
    );
  }

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
    { cookies: serverComponentCookies(cookies()) },
  );

  // Load the thread + author names. Deleted comments stay in the
  // list as tombstones (RLS keeps them readable so the timeline
  // doesn't jump around).
  const { data: rawComments } = await supabase
    .from('company_comments')
    .select(
      'id, company_id, author_id, body, created_at, edited_at, deleted_at, author:profiles!company_comments_author_id_fkey(full_name)',
    )
    .eq('company_id', params.id)
    .order('created_at', { ascending: true })
    .limit(500)
    .returns<RawCommentRow[]>();

  const comments = rawComments ?? [];

  // Load the mention rows for all comments on this thread in one shot.
  const commentIds = comments.map((c) => c.id);
  let mentionRows: RawMentionRow[] = [];
  if (commentIds.length > 0) {
    const { data } = await supabase
      .from('company_comment_mentions')
      .select(
        'comment_id, mentioned_profile_id, profile:profiles!company_comment_mentions_mentioned_profile_id_fkey(full_name, is_active)',
      )
      .in('comment_id', commentIds)
      .returns<RawMentionRow[]>();
    mentionRows = data ?? [];
  }

  const mentionsByComment = new Map<string, MentionParticipant[]>();
  for (const m of mentionRows) {
    const arr = mentionsByComment.get(m.comment_id) ?? [];
    arr.push({
      id: m.mentioned_profile_id,
      full_name: m.profile?.full_name ?? 'Unknown',
      is_active: m.profile?.is_active ?? false,
    });
    mentionsByComment.set(m.comment_id, arr);
  }

  const rows: CommentRow[] = comments.map((c) => ({
    id: c.id,
    author_id: c.author_id,
    author_name: c.author?.full_name ?? null,
    body: c.body,
    created_at: c.created_at,
    edited_at: c.edited_at,
    deleted_at: c.deleted_at,
    mentions: mentionsByComment.get(c.id) ?? [],
  }));

  // BD-team profiles for the composer's @-autocomplete. Same set the
  // RPC restricts mention notifications to.
  type ProfileOption = { id: string; full_name: string; role: string };
  const { data: teamProfiles } = await supabase
    .from('profiles')
    .select('id, full_name, role')
    .eq('is_active', true)
    .in('role', ['admin', 'bd_head', 'bd_manager'])
    .order('full_name', { ascending: true })
    .returns<ProfileOption[]>();

  const participants = (teamProfiles ?? []).map((p) => ({
    id: p.id,
    full_name: p.full_name,
    role: p.role,
  }));

  const targetCommentId = searchParams.comment ?? null;
  const canPost = ['admin', 'bd_head', 'bd_manager'].includes(user.role);

  // Live 'mention' notifications for this viewer scoped to this
  // company. Feeds the on-scroll clearer — one observer per row.
  const unreadMentions = await listUnreadMentionsForCompany(params.id);

  return (
    <div className="space-y-4">
      {canPost && (
        <CommentComposer companyId={params.id} participants={participants} />
      )}

      <Card>
        <CardHeader>
          <CardTitle>Discussion</CardTitle>
          <CardDescription>
            Internal thread. Type <code className="rounded bg-agsi-offWhite/70 px-1">@</code> to mention a teammate — they&apos;ll get a notification linking back to this comment.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {rows.length === 0 ? (
            <p className="p-6 text-sm text-agsi-darkGray">
              No comments yet — start the thread above.
            </p>
          ) : (
            <CommentList
              companyId={params.id}
              comments={rows}
              currentUserId={user.id}
              isAdmin={user.role === 'admin'}
              targetCommentId={targetCommentId}
            />
          )}
        </CardContent>
      </Card>

      {unreadMentions.length > 0 && <MentionClearer mentions={unreadMentions} />}
    </div>
  );
}

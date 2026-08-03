import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { serverComponentCookies } from '@/lib/supabase/cookie-adapter';
import { getCurrentUser } from '@/lib/auth/get-user';
import { getCrmSetupMode } from '@/lib/setup-mode';
import { Badge } from '@/components/ui/badge';
import { LevelBadge } from '@/components/domain/LevelBadge';
import { LevelChangeButton } from '@/components/domain/LevelChangeDialog';
import { COMPANY_TYPE_LABEL } from '@/lib/zod/company';
import { CompanyTabs } from './_components/CompanyTabs';
import { DiscussionRail } from './_components/DiscussionRail';
import {
  getUnreadMentionCountForCompany,
  listUnreadMentionsForCompany,
} from '@/server/actions/company-mentions';
import type { CommentRow, MentionParticipant } from './discussion/_components/CommentList';
import type { ComposerParticipant } from './discussion/_components/CommentComposer';

export const dynamic = 'force-dynamic';

type CompanyHeaderRow = {
  id: string;
  canonical_name: string;
  company_type: keyof typeof COMPANY_TYPE_LABEL;
  city: string | null;
  current_level: 'L0' | 'L1' | 'L2' | 'L3' | 'L4' | 'L5';
  is_key_stakeholder: boolean;
  has_active_projects: boolean;
  source: string;
  owner_id: string | null;
};

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

type RawProfileRow = { id: string; full_name: string; role: string };

export default async function CompanyLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: { id: string };
}) {
  const user = await getCurrentUser();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
    { cookies: serverComponentCookies(cookies()) },
  );
  const { data: company } = await supabase
    .from('companies')
    .select(
      'id, canonical_name, company_type, city, current_level, is_key_stakeholder, has_active_projects, source, owner_id',
    )
    .eq('id', params.id)
    .single<CompanyHeaderRow>();

  if (!company) notFound();

  const crmSetupMode = await getCrmSetupMode();

  // The Discussion is a BD-team channel. Leadership never sees the
  // rail (matches the pre-#157 tab-level gate); everyone else does.
  const isBdTeam = ['admin', 'bd_head', 'bd_manager'].includes(user.role);
  const canPost = isBdTeam;

  // Load rail data alongside the header so a single layout render
  // hydrates every tab. Skipped entirely for leadership so no data
  // leaks server-side and the query cost is zero for that role.
  let railComments: CommentRow[] = [];
  let railParticipants: ComposerParticipant[] = [];
  let unreadMentions: Array<{ notificationId: string; commentId: string }> = [];
  let unreadMentionCount = 0;

  if (isBdTeam) {
    const { data: rawComments } = await supabase
      .from('company_comments')
      .select(
        'id, company_id, author_id, body, created_at, edited_at, deleted_at, author:profiles!company_comments_author_id_fkey(full_name)',
      )
      .eq('company_id', company.id)
      // Newest at top — the composer sits above this list so posting
      // and reading both happen without scrolling. The ?comment=<id>
      // deep-link scroll uses getElementById and is order-agnostic.
      .order('created_at', { ascending: false })
      .limit(500)
      .returns<RawCommentRow[]>();

    const comments = rawComments ?? [];
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

    railComments = comments.map((c) => ({
      id: c.id,
      author_id: c.author_id,
      author_name: c.author?.full_name ?? null,
      body: c.body,
      created_at: c.created_at,
      edited_at: c.edited_at,
      deleted_at: c.deleted_at,
      mentions: mentionsByComment.get(c.id) ?? [],
    }));

    const { data: teamProfiles } = await supabase
      .from('profiles')
      .select('id, full_name, role')
      .eq('is_active', true)
      .in('role', ['admin', 'bd_head', 'bd_manager'])
      .order('full_name', { ascending: true })
      .returns<RawProfileRow[]>();

    railParticipants = (teamProfiles ?? []).map((p) => ({
      id: p.id,
      full_name: p.full_name,
      role: p.role,
    }));

    unreadMentions = await listUnreadMentionsForCompany(company.id);
    unreadMentionCount = await getUnreadMentionCountForCompany(company.id);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/companies" className="text-xs text-agsi-darkGray hover:underline">
            ← Companies
          </Link>
          <div className="mt-1 flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold text-agsi-navy">{company.canonical_name}</h1>
            <LevelBadge level={company.current_level} />
            {company.is_key_stakeholder && <Badge variant="gold">Key</Badge>}
            {company.has_active_projects && <Badge variant="green">Active projects</Badge>}
          </div>
          <p className="mt-1 text-sm text-agsi-darkGray">
            {COMPANY_TYPE_LABEL[company.company_type]} · {company.city ?? 'No city'} · Source:{' '}
            {company.source}
          </p>
        </div>
        <LevelChangeButton
          companyId={company.id}
          companyName={company.canonical_name}
          currentLevel={company.current_level}
          userRole={user.role}
          isOwner={company.owner_id === user.id}
          crmSetupMode={crmSetupMode}
          variant="button"
        />
      </div>

      {/* Two-column body when the viewer has rail access; single
          column for leadership so the tabs get the whole width. */}
      <div className={isBdTeam ? 'flex items-start gap-4' : ''}>
        <div className={isBdTeam ? 'flex-1 min-w-0 space-y-6' : 'space-y-6'}>
          <CompanyTabs companyId={company.id} />
          {children}
        </div>

        {isBdTeam && (
          <DiscussionRail
            companyId={company.id}
            currentUserId={user.id}
            canPost={canPost}
            isAdmin={user.role === 'admin'}
            initialComments={railComments}
            initialParticipants={railParticipants}
            initialUnreadMentions={unreadMentions}
            initialUnreadCount={unreadMentionCount}
          />
        )}
      </div>
    </div>
  );
}

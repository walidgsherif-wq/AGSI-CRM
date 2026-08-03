'use server';

import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { serverComponentCookies } from '@/lib/supabase/cookie-adapter';
import { getCurrentUser } from '@/lib/auth/get-user';

function supabase() {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
    { cookies: serverComponentCookies(cookies()) },
  );
}

export type UnreadMentionForCompany = {
  notificationId: string;
  commentId: string;
};

/**
 * Scoped read on the notifications table for a single company+viewer:
 * live 'mention' notifications (not read, not dismissed) whose
 * related_company_id matches. Backs both the tab-badge count and the
 * per-comment IntersectionObserver mapping — one query, both callers.
 *
 * `entity_id` is the company_comments.id (0094:179), so the comment
 * link is direct — no join into company_comment_mentions needed.
 * RLS on notifications restricts to the caller's own rows.
 */
export async function listUnreadMentionsForCompany(
  companyId: string,
): Promise<UnreadMentionForCompany[]> {
  await getCurrentUser();
  const { data } = await supabase()
    .from('notifications')
    .select('id, entity_id, entity_type')
    .eq('notification_type', 'mention')
    .eq('related_company_id', companyId)
    .eq('entity_type', 'company_comment')
    .eq('is_read', false)
    .is('dismissed_at', null)
    .not('entity_id', 'is', null)
    .returns<Array<{ id: string; entity_id: string; entity_type: string }>>();

  return (data ?? []).map((r) => ({
    notificationId: r.id,
    commentId: r.entity_id,
  }));
}

/**
 * Just the count for the tab-label badge. Uses head+count so no
 * rows come back over the wire.
 */
export async function getUnreadMentionCountForCompany(
  companyId: string,
): Promise<number> {
  await getCurrentUser();
  const { count } = await supabase()
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('notification_type', 'mention')
    .eq('related_company_id', companyId)
    .eq('entity_type', 'company_comment')
    .eq('is_read', false)
    .is('dismissed_at', null);
  return count ?? 0;
}

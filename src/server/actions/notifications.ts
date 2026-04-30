'use server';

import { revalidatePath } from 'next/cache';
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

export type NotificationRow = {
  id: string;
  notification_type: string;
  subject: string;
  body: string;
  link_url: string | null;
  is_read: boolean;
  related_company_id: string | null;
  related_task_id: string | null;
  created_at: string;
};

export type NotificationSummary = {
  unread: number;
  recent: NotificationRow[];
};

/**
 * Polled every minute by the bell. RLS scopes to the caller — no need to
 * filter by recipient_id explicitly.
 */
export async function getNotificationSummary(): Promise<NotificationSummary> {
  await getCurrentUser();
  const sb = supabase();

  const [recentRes, unreadRes] = await Promise.all([
    sb
      .from('notifications')
      .select(
        'id, notification_type, subject, body, link_url, is_read, related_company_id, related_task_id, created_at',
      )
      .order('created_at', { ascending: false })
      .limit(10)
      .returns<NotificationRow[]>(),
    sb
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('is_read', false),
  ]);

  return {
    recent: recentRes.data ?? [],
    unread: unreadRes.count ?? 0,
  };
}

export async function listNotifications(opts?: {
  filter?: 'all' | 'unread';
  type?: string | 'all';
  limit?: number;
}): Promise<{ rows: NotificationRow[] }> {
  await getCurrentUser();
  const filter = opts?.filter ?? 'all';
  const type = opts?.type ?? 'all';
  const limit = Math.min(opts?.limit ?? 100, 200);

  let query = supabase()
    .from('notifications')
    .select(
      'id, notification_type, subject, body, link_url, is_read, related_company_id, related_task_id, created_at',
    )
    .order('created_at', { ascending: false })
    .limit(limit);
  if (filter === 'unread') query = query.eq('is_read', false);
  if (type !== 'all') query = query.eq('notification_type', type);

  const { data } = await query.returns<NotificationRow[]>();
  return { rows: data ?? [] };
}

export async function markRead(id: string) {
  await getCurrentUser();
  // RLS scopes to recipient_id; column-level scope enforced here (only is_read flips).
  const { error } = await supabase()
    .from('notifications')
    .update({ is_read: true })
    .eq('id', id);
  if (error) return { error: error.message };
  revalidatePath('/notifications');
  return { ok: true };
}

export async function markAllRead() {
  await getCurrentUser();
  const { error } = await supabase()
    .from('notifications')
    .update({ is_read: true })
    .eq('is_read', false);
  if (error) return { error: error.message };
  revalidatePath('/notifications');
  return { ok: true };
}

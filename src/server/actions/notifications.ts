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
 * Returns the set of notification_types this user has opted out of on
 * the in-app channel. Bell + inbox use this to filter.
 */
async function mutedTypes(): Promise<Set<string>> {
  const sb = supabase();
  const { data } = await sb
    .from('notification_preferences')
    .select('notification_type, in_app_enabled')
    .eq('in_app_enabled', false)
    .returns<Array<{ notification_type: string }>>();
  return new Set((data ?? []).map((r) => r.notification_type));
}

export async function getNotificationSummary(): Promise<NotificationSummary> {
  await getCurrentUser();
  const sb = supabase();
  const muted = await mutedTypes();

  let recentQuery = sb
    .from('notifications')
    .select(
      'id, notification_type, subject, body, link_url, is_read, related_company_id, related_task_id, created_at',
    )
    .order('created_at', { ascending: false })
    .limit(20); // pull a little extra; we'll filter then slice
  if (muted.size > 0) {
    recentQuery = recentQuery.not(
      'notification_type',
      'in',
      `(${[...muted].join(',')})`,
    );
  }

  let unreadQuery = sb
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('is_read', false);
  if (muted.size > 0) {
    unreadQuery = unreadQuery.not(
      'notification_type',
      'in',
      `(${[...muted].join(',')})`,
    );
  }

  const [recentRes, unreadRes] = await Promise.all([
    recentQuery.returns<NotificationRow[]>(),
    unreadQuery,
  ]);

  return {
    recent: (recentRes.data ?? []).slice(0, 10),
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
  if (type !== 'all') {
    // explicit type filter overrides the "muted" prefs — user may want
    // to read past entries even of a muted type.
    query = query.eq('notification_type', type);
  } else {
    const muted = await mutedTypes();
    if (muted.size > 0) {
      query = query.not(
        'notification_type',
        'in',
        `(${[...muted].join(',')})`,
      );
    }
  }

  const { data } = await query.returns<NotificationRow[]>();
  return { rows: data ?? [] };
}

// =====================================================================
// Notification preferences
// =====================================================================

export type NotificationPrefRow = {
  notification_type: string;
  in_app_enabled: boolean;
  email_enabled: boolean;
  whatsapp_enabled: boolean;
};

export async function getMyPreferences(): Promise<Record<string, NotificationPrefRow>> {
  await getCurrentUser();
  const { data } = await supabase()
    .from('notification_preferences')
    .select('notification_type, in_app_enabled, email_enabled, whatsapp_enabled')
    .returns<NotificationPrefRow[]>();
  const map: Record<string, NotificationPrefRow> = {};
  for (const r of data ?? []) {
    map[r.notification_type] = r;
  }
  return map;
}

export async function setInAppPreference(
  notificationType: string,
  enabled: boolean,
) {
  const user = await getCurrentUser();
  const { error } = await supabase()
    .from('notification_preferences')
    .upsert(
      {
        user_id: user.id,
        notification_type: notificationType,
        in_app_enabled: enabled,
        // email + whatsapp default off; preserve if present.
      },
      { onConflict: 'user_id,notification_type', ignoreDuplicates: false },
    );
  if (error) return { error: error.message };
  revalidatePath('/settings/notifications');
  revalidatePath('/notifications');
  return { ok: true };
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

import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { serverComponentCookies } from '@/lib/supabase/cookie-adapter';
import { getCurrentUser } from '@/lib/auth/get-user';
import { listNotifications } from '@/server/actions/notifications';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { COMPANY_TYPE_LABEL } from '@/lib/zod/company';
import type { Level } from '@/types/domain';
import {
  NotificationsInbox,
  type LevelChangeContext,
} from './_components/NotificationsInbox';

export const dynamic = 'force-dynamic';

type SearchParams = {
  filter?: string;
  type?: string;
};

type LevelChangeRequestRow = {
  id: string;
  company_id: string;
  from_level: Level;
  to_level: Level;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  evidence_note: string;
  created_at: string;
  company:
    | { canonical_name: string; company_type: keyof typeof COMPANY_TYPE_LABEL }
    | { canonical_name: string; company_type: keyof typeof COMPANY_TYPE_LABEL }[]
    | null;
  requester: { full_name: string } | { full_name: string }[] | null;
};

function pickOne<T>(v: T | T[] | null | undefined): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : (v ?? null);
}

/**
 * Parse the directional summary out of a level-change notification
 * subject so we can match the notification back to the exact
 * level_change_request row (notifications don't carry request_id).
 * Format set by notify_admins_on_level_request (0029) +
 * approve_level_change_request / reject_level_change_request (0029,0031).
 */
function parseLevelChangeSubject(subject: string): {
  status: 'pending' | 'approved' | 'rejected';
  from: Level;
  to: Level;
} | null {
  const m = subject.match(
    /^(Pending review|Approved|Rejected):\s+(L[0-5])\s*→\s*(L[0-5])/,
  );
  if (!m) return null;
  const status =
    m[1] === 'Pending review'
      ? 'pending'
      : m[1] === 'Approved'
        ? 'approved'
        : 'rejected';
  return { status, from: m[2] as Level, to: m[3] as Level };
}

export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const filter = (searchParams.filter === 'unread' ? 'unread' : 'all') as
    | 'all'
    | 'unread';
  const type = searchParams.type ?? 'all';

  const user = await getCurrentUser();
  const { rows } = await listNotifications({ filter, type, limit: 200 });

  // Enrich level-change notifications with the matching request, the
  // company name + type, and the requester's full name. No request_id
  // is stored on the notification, so we match by subject-parsed
  // (status, from, to) within the related_company_id.
  const lcCompanyIds = Array.from(
    new Set(
      rows
        .filter(
          (r) =>
            r.notification_type === 'level_change' && r.related_company_id,
        )
        .map((r) => r.related_company_id as string),
    ),
  );

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
    { cookies: serverComponentCookies(cookies()) },
  );

  let lcRequests: LevelChangeRequestRow[] = [];
  if (lcCompanyIds.length > 0) {
    const { data } = await supabase
      .from('level_change_requests')
      .select(
        'id, company_id, from_level, to_level, status, evidence_note, created_at, company:companies(canonical_name, company_type), requester:profiles!level_change_requests_requested_by_fkey(full_name)',
      )
      .in('company_id', lcCompanyIds)
      .order('created_at', { ascending: false })
      .returns<LevelChangeRequestRow[]>();
    lcRequests = data ?? [];
  }

  // Build the per-notification context map. Match by
  // (company_id, status, from, to); freshest wins (the order above is
  // created_at DESC, so first match per notification is the freshest).
  const lcByNotificationId = new Map<string, LevelChangeContext>();
  for (const n of rows) {
    if (n.notification_type !== 'level_change') continue;
    if (!n.related_company_id) continue;
    const parsed = parseLevelChangeSubject(n.subject);
    if (!parsed) continue;
    const match = lcRequests.find(
      (r) =>
        r.company_id === n.related_company_id &&
        r.status === parsed.status &&
        r.from_level === parsed.from &&
        r.to_level === parsed.to,
    );
    if (!match) continue;
    const company = pickOne(match.company);
    const requester = pickOne(match.requester);
    lcByNotificationId.set(n.id, {
      request_id: match.id,
      from_level: match.from_level,
      to_level: match.to_level,
      status: match.status,
      evidence_note: match.evidence_note,
      company_id: match.company_id,
      company_name: company?.canonical_name ?? 'Unknown stakeholder',
      company_type_label: company
        ? (COMPANY_TYPE_LABEL[company.company_type] ?? company.company_type)
        : '—',
      requester_name: requester?.full_name ?? 'Unknown',
    });
  }
  const lcContext = Object.fromEntries(lcByNotificationId);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold text-agsi-navy">Notifications</h1>
        <p className="mt-1 text-sm text-agsi-darkGray">
          Your inbox. {rows.length} {rows.length === 1 ? 'notification' : 'notifications'}{' '}
          ({filter === 'unread' ? 'unread only' : 'all'}
          {type !== 'all' ? ` · type ${type}` : ''}).
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Inbox</CardTitle>
          <CardDescription>
            In-app delivery. Email is deferred to v1.1 per architecture decision D-3.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <NotificationsInbox
            initial={rows}
            initialFilter={filter}
            initialType={type}
            levelChangeContext={lcContext}
            viewerRole={user.role}
          />
        </CardContent>
      </Card>
    </div>
  );
}

import Link from 'next/link';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { serverComponentCookies } from '@/lib/supabase/cookie-adapter';
import { requireRole } from '@/lib/auth/require-role';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ResolveActions } from './_components/ResolveActions';

export const dynamic = 'force-dynamic';

type Status = 'pending' | 'resolved' | 'discarded';

type Row = {
  id: string;
  message_id: string;
  from_email: string;
  from_name: string | null;
  to_emails: string[];
  cc_emails: string[];
  subject: string;
  body_preview: string | null;
  received_at: string;
  status: Status;
  reason: string;
  review_note: string | null;
  resolved_at: string | null;
  resolved_engagement_id: string | null;
  reviewer: { full_name: string } | null;
};

const STATUSES: Status[] = ['pending', 'resolved', 'discarded'];

const STATUS_VARIANT: Record<Status, 'amber' | 'green' | 'neutral'> = {
  pending: 'amber',
  resolved: 'green',
  discarded: 'neutral',
};

export default async function InboundEmailPage({
  searchParams,
}: {
  searchParams: { status?: string };
}) {
  await requireRole(['admin']);

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
    { cookies: serverComponentCookies(cookies()) },
  );

  const status = (STATUSES as readonly string[]).includes(searchParams.status ?? '')
    ? (searchParams.status as Status)
    : 'pending';

  const [rowsRes, companiesRes] = await Promise.all([
    supabase
      .from('inbound_email_unmatched')
      .select(
        'id, message_id, from_email, from_name, to_emails, cc_emails, subject, body_preview, received_at, status, reason, review_note, resolved_at, resolved_engagement_id, reviewer:profiles!inbound_email_unmatched_resolved_by_fkey(full_name)',
      )
      .eq('status', status)
      .order('received_at', { ascending: false })
      .limit(200)
      .returns<Row[]>(),
    supabase
      .from('companies')
      .select('id, canonical_name')
      .eq('is_active', true)
      .order('canonical_name')
      .limit(2000),
  ]);

  const rows = rowsRes.data ?? [];
  const companies =
    (companiesRes.data ?? []) as Array<{ id: string; canonical_name: string }>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-agsi-navy">Inbound emails</h1>
        <p className="mt-1 text-sm text-agsi-darkGray">
          Emails the auto-matcher couldn&apos;t link to a known company. Resolve each by
          picking the right company; the system creates the engagement + email row.
        </p>
      </div>

      <div className="flex gap-2">
        {STATUSES.map((s) => (
          <Link
            key={s}
            href={`/admin/inbound-email?status=${s}`}
            className={
              status === s
                ? 'rounded-lg bg-agsi-navy px-3 py-1 text-xs font-medium text-white'
                : 'rounded-lg border border-agsi-midGray px-3 py-1 text-xs font-medium text-agsi-navy hover:bg-agsi-lightGray/40'
            }
          >
            {s}
          </Link>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            {rows.length} {status} {rows.length === 1 ? 'email' : 'emails'}
          </CardTitle>
          <CardDescription>
            Webhook URL is configured per provider. See{' '}
            <code>supabase/APPLY-M9-EMAIL.md</code> for setup.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {rows.length === 0 ? (
            <p className="p-6 text-sm text-agsi-darkGray">
              No {status} emails.
              {status === 'pending' && ' All caught up — nothing waiting for review.'}
            </p>
          ) : (
            <ul className="divide-y divide-agsi-lightGray">
              {rows.map((r) => (
                <li key={r.id} className="grid gap-4 px-4 py-4 lg:grid-cols-3">
                  <div className="space-y-1 lg:col-span-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={STATUS_VARIANT[r.status]}>{r.status}</Badge>
                      <span className="text-xs text-agsi-darkGray">
                        {new Date(r.received_at).toLocaleString()}
                      </span>
                    </div>
                    <p className="text-sm font-medium text-agsi-navy">{r.subject}</p>
                    <p className="text-xs text-agsi-darkGray">
                      <span className="font-medium">From:</span>{' '}
                      {r.from_name ? `${r.from_name} <${r.from_email}>` : r.from_email}
                    </p>
                    {r.to_emails.length > 0 && (
                      <p className="text-xs text-agsi-darkGray">
                        <span className="font-medium">To:</span> {r.to_emails.join(', ')}
                      </p>
                    )}
                    {r.cc_emails.length > 0 && (
                      <p className="text-xs text-agsi-darkGray">
                        <span className="font-medium">Cc:</span> {r.cc_emails.join(', ')}
                      </p>
                    )}
                    <p className="text-xs text-rag-amber">Reason: {r.reason}</p>
                    {r.body_preview && (
                      <p className="mt-2 line-clamp-3 whitespace-pre-wrap text-xs text-agsi-darkGray">
                        {r.body_preview}
                      </p>
                    )}
                    {r.status !== 'pending' && r.review_note && (
                      <p className="mt-2 text-xs text-agsi-darkGray">
                        <em>&ldquo;{r.review_note}&rdquo;</em> ·{' '}
                        {r.reviewer?.full_name ?? 'admin'} ·{' '}
                        {r.resolved_at && new Date(r.resolved_at).toLocaleDateString()}
                      </p>
                    )}
                    {r.status === 'resolved' && r.resolved_engagement_id && (
                      <p className="text-xs text-agsi-green">
                        Resolved → engagement {r.resolved_engagement_id.slice(0, 8)}
                      </p>
                    )}
                  </div>
                  <div>
                    {r.status === 'pending' ? (
                      <ResolveActions unmatchedId={r.id} companies={companies} />
                    ) : (
                      <p className="text-xs italic text-agsi-darkGray">No further action.</p>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

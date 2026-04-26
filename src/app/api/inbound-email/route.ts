// POST /api/inbound-email
// Inbound email webhook. Receives parsed-email JSON from a transactional
// email provider (Postmark Inbound, SendGrid Inbound Parse, AWS SES). The
// shape we accept is normalised — see the README for per-provider mapping.
//
// AuthN: query-string token must match INBOUND_EMAIL_SECRET env var. The
// inbound provider posts to a URL like:
//   https://agsi-crm.vercel.app/api/inbound-email?token=<secret>
// Without the token, all requests are rejected as 401.

import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';
export const maxDuration = 30;

type ParsedEmail = {
  message_id: string;
  from_email: string;
  from_name?: string | null;
  to_emails: string[];
  cc_emails: string[];
  subject: string;
  body_text?: string | null;
  body_html?: string | null;
  received_at?: string | null;
  has_attachments?: boolean;
};

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
}

/** Normalise Postmark Inbound's payload to our shape. Postmark fields:
 *  https://postmarkapp.com/developer/webhooks/inbound-webhook */
function fromPostmark(body: Record<string, unknown>): ParsedEmail | null {
  if (!body.MessageID || !body.From || !body.Subject) return null;
  const ccFull = (body.CcFull as Array<{ Email: string }> | undefined) ?? [];
  const toFull = (body.ToFull as Array<{ Email: string }> | undefined) ?? [];
  const fromFull = body.FromFull as { Email: string; Name?: string } | undefined;
  return {
    message_id: String(body.MessageID),
    from_email: (fromFull?.Email ?? body.From ?? '').toString().toLowerCase(),
    from_name: fromFull?.Name ?? null,
    to_emails: toFull.map((t) => t.Email.toLowerCase()),
    cc_emails: ccFull.map((c) => c.Email.toLowerCase()),
    subject: String(body.Subject),
    body_text: (body.TextBody as string | null) ?? null,
    body_html: (body.HtmlBody as string | null) ?? null,
    received_at: (body.Date as string | null) ?? null,
    has_attachments: Array.isArray(body.Attachments) && body.Attachments.length > 0,
  };
}

/** Normalise a generic shape — used by tests + custom forwarders. */
function fromGeneric(body: Record<string, unknown>): ParsedEmail | null {
  if (!body.message_id || !body.from_email || !body.subject) return null;
  return {
    message_id: String(body.message_id),
    from_email: String(body.from_email).toLowerCase(),
    from_name: (body.from_name as string | null) ?? null,
    to_emails: ((body.to_emails as string[] | undefined) ?? []).map((s) => s.toLowerCase()),
    cc_emails: ((body.cc_emails as string[] | undefined) ?? []).map((s) => s.toLowerCase()),
    subject: String(body.subject),
    body_text: (body.body_text as string | null) ?? null,
    body_html: (body.body_html as string | null) ?? null,
    received_at: (body.received_at as string | null) ?? null,
    has_attachments: !!body.has_attachments,
  };
}

function parseBody(raw: Record<string, unknown>): ParsedEmail | null {
  // Postmark hint: presence of MessageID + FromFull
  if ('MessageID' in raw && 'FromFull' in raw) return fromPostmark(raw);
  // Default: assume generic
  return fromGeneric(raw);
}

export async function POST(req: NextRequest) {
  // 1. Token check
  const expected = process.env.INBOUND_EMAIL_SECRET;
  if (!expected) {
    return NextResponse.json({ error: 'Server not configured' }, { status: 500 });
  }
  const token = req.nextUrl.searchParams.get('token');
  if (token !== expected) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  // 2. Parse body
  let raw: Record<string, unknown>;
  try {
    raw = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  const email = parseBody(raw);
  if (!email) {
    return NextResponse.json({ error: 'unrecognised email shape' }, { status: 400 });
  }

  const admin = adminClient();

  // 3. Dedup by message_id (engagement_emails has UNIQUE constraint, but
  // checking ahead avoids 23505s and is more readable).
  const { data: existingEngagement } = await admin
    .from('engagement_emails')
    .select('id')
    .eq('message_id', email.message_id)
    .maybeSingle();
  if (existingEngagement) {
    return NextResponse.json({ ok: true, deduped: true });
  }
  const { data: existingUnmatched } = await admin
    .from('inbound_email_unmatched')
    .select('id')
    .eq('message_id', email.message_id)
    .maybeSingle();
  if (existingUnmatched) {
    return NextResponse.json({ ok: true, deduped: true });
  }

  // 4. Match the BD user. Try From first; if not a profile, try the
  // recipient list (might be inbound stakeholder reply).
  type ProfileRow = { id: string; email: string };
  const { data: profileFrom } = await admin
    .from('profiles')
    .select('id, email')
    .eq('email', email.from_email)
    .maybeSingle<ProfileRow>();

  let bdUserId: string | null = profileFrom?.id ?? null;
  let direction: 'outbound' | 'inbound' = 'outbound';
  let stakeholderEmails = [...email.to_emails, ...email.cc_emails];

  if (!bdUserId) {
    // From wasn't a BD user. See if any recipient is.
    const candidates = [...email.to_emails, ...email.cc_emails];
    if (candidates.length > 0) {
      const { data: profileTo } = await admin
        .from('profiles')
        .select('id, email')
        .in('email', candidates)
        .limit(1)
        .maybeSingle<ProfileRow>();
      if (profileTo) {
        bdUserId = profileTo.id;
        direction = 'inbound';
        // Stakeholder is the From; recipient list (minus the BD user + the
        // system address) is everyone else.
        stakeholderEmails = [
          email.from_email,
          ...candidates.filter(
            (c) => c !== profileTo.email,
          ),
        ];
      }
    }
  }

  // 5. Find candidate company by stakeholder emails
  type CompanyRow = { id: string };
  let companyId: string | null = null;
  if (stakeholderEmails.length > 0) {
    // companies.email exact match
    const { data: byEmail } = await admin
      .from('companies')
      .select('id')
      .in('email', stakeholderEmails)
      .limit(1)
      .maybeSingle<CompanyRow>();
    companyId = byEmail?.id ?? null;
    if (!companyId) {
      const { data: byContact } = await admin
        .from('companies')
        .select('id')
        .in('key_contact_email', stakeholderEmails)
        .limit(1)
        .maybeSingle<CompanyRow>();
      companyId = byContact?.id ?? null;
    }
  }

  const receivedAt = email.received_at ? new Date(email.received_at).toISOString() : new Date().toISOString();

  // 6. If we matched both BD user and company, create the engagement.
  if (bdUserId && companyId) {
    const { data: ins, error: insErr } = await admin
      .from('engagements')
      .insert({
        company_id: companyId,
        engagement_type: 'email',
        summary: `Email: ${email.subject.slice(0, 280)}`,
        engagement_date: receivedAt.slice(0, 10),
        created_by: bdUserId,
      })
      .select('id')
      .single();
    if (insErr || !ins) {
      return NextResponse.json(
        { error: insErr?.message ?? 'engagement insert failed' },
        { status: 500 },
      );
    }

    const { error: emailErr } = await admin.from('engagement_emails').insert({
      engagement_id: ins.id,
      message_id: email.message_id,
      from_email: email.from_email,
      from_name: email.from_name,
      to_emails: email.to_emails,
      cc_emails: email.cc_emails,
      subject: email.subject,
      body_text: email.body_text,
      body_html: email.body_html,
      has_attachments: !!email.has_attachments,
      received_at: receivedAt,
      raw_payload: raw,
      direction,
    });
    if (emailErr) {
      // Rollback the engagement to avoid orphaned rows
      await admin.from('engagements').delete().eq('id', ins.id);
      return NextResponse.json({ error: emailErr.message }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      matched: true,
      engagement_id: ins.id,
      direction,
    });
  }

  // 7. Otherwise queue for admin review
  const reason = !bdUserId
    ? 'sender + recipients unknown — no BD user found'
    : 'no company matched the recipient/sender emails';

  const { error: unmErr } = await admin.from('inbound_email_unmatched').insert({
    message_id: email.message_id,
    from_email: email.from_email,
    from_name: email.from_name,
    to_emails: email.to_emails,
    cc_emails: email.cc_emails,
    subject: email.subject,
    body_preview: (email.body_text ?? '').slice(0, 1000),
    received_at: receivedAt,
    raw_payload: raw,
    reason,
  });
  if (unmErr) return NextResponse.json({ error: unmErr.message }, { status: 500 });

  // Notify all admins so the queue gets reviewed
  const { data: admins } = await admin.from('profiles').select('id').eq('role', 'admin');
  if (admins && (admins as Array<{ id: string }>).length > 0) {
    await admin.from('notifications').insert(
      (admins as Array<{ id: string }>).map((a) => ({
        recipient_id: a.id,
        notification_type: 'unmatched_company',
        subject: `Inbound email needs review: ${email.subject.slice(0, 120)}`,
        body: `From ${email.from_email}. Reason: ${reason}.`,
        link_url: '/admin/inbound-email',
      })),
    );
  }

  return NextResponse.json({ ok: true, matched: false, reason });
}

export async function GET() {
  // Health check for the provider's webhook UI
  return NextResponse.json({ ok: true, service: 'inbound-email' });
}

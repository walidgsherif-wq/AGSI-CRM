// POST /api/inbound-email
// Inbound email webhook. Receives parsed-email JSON from a transactional
// email provider (Postmark Inbound, SendGrid Inbound Parse, AWS SES). The
// shape we accept is normalised — see the README for per-provider mapping.
//
// AuthN: query-string token must match INBOUND_EMAIL_SECRET env var. The
// inbound provider posts to a URL like:
//   https://agsi-crm.vercel.app/api/inbound-email?token=<secret>
// Without the token, all requests are rejected as 401.
//
// Attribution model (Block 5 revised):
//   1. Identify BD users — profiles whose `email` OR `work_email` (Block 6)
//      matches any address in from/to/cc.
//   2. Sender is a BD user → outbound. Engagement created_by = sender.
//      Stakeholder emails = (to ∪ cc) − BD profile emails − inbound system
//      address.
//   3. Sender is NOT a BD user → inbound. Engagement attribution comes from
//      the company's owner_id, not from any recipient. Stakeholder emails
//      = [from_email] ∪ (to ∪ cc) − BD profile emails − inbound system
//      address.
//   4. Resolve company from stakeholder emails against companies.email and
//      contacts.email (deleted_at IS NULL). Collapse to distinct company
//      ids.
//      - exactly one company:
//          outbound → engagement with created_by = sender.
//          inbound  → if company.owner_id is set, engagement with
//                     created_by = owner; if unowned, queue with reason
//                     'stakeholder unclaimed'.
//      - two or more       → queue with 'ambiguous — matches multiple
//                            companies'.
//      - zero              → queue with 'no company matched'.
//   5. The legacy key_contact_email lookup and the recipient-BD-user
//      attribution path are gone.

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
  if ('MessageID' in raw && 'FromFull' in raw) return fromPostmark(raw);
  return fromGeneric(raw);
}

type BdProfileRow = { id: string; email: string | null; work_email: string | null };

/**
 * Identify which addresses belong to BD users by matching against
 * profiles.email OR profiles.work_email. Two .in() queries merged by id
 * — PostgREST's `or` filter can't combine two .in lists cleanly, and
 * two roundtrips is fine for the handful of addresses on an email.
 */
async function loadBdProfiles(
  admin: ReturnType<typeof adminClient>,
  addresses: string[],
): Promise<BdProfileRow[]> {
  if (addresses.length === 0) return [];
  const [byEmail, byWork] = await Promise.all([
    admin
      .from('profiles')
      .select('id, email, work_email')
      .in('email', addresses)
      .returns<BdProfileRow[]>(),
    admin
      .from('profiles')
      .select('id, email, work_email')
      .in('work_email', addresses)
      .returns<BdProfileRow[]>(),
  ]);
  const byId = new Map<string, BdProfileRow>();
  for (const r of byEmail.data ?? []) byId.set(r.id, r);
  for (const r of byWork.data ?? []) byId.set(r.id, r);
  return Array.from(byId.values());
}

function bdAddresses(profiles: BdProfileRow[]): Set<string> {
  const s = new Set<string>();
  for (const p of profiles) {
    if (p.email) s.add(p.email.toLowerCase());
    if (p.work_email) s.add(p.work_email.toLowerCase());
  }
  return s;
}

function findProfileForAddress(
  profiles: BdProfileRow[],
  address: string,
): BdProfileRow | null {
  const a = address.toLowerCase();
  for (const p of profiles) {
    if ((p.email && p.email.toLowerCase() === a) ||
        (p.work_email && p.work_email.toLowerCase() === a)) {
      return p;
    }
  }
  return null;
}

async function resolveCompanyIds(
  admin: ReturnType<typeof adminClient>,
  stakeholderEmails: string[],
): Promise<string[]> {
  if (stakeholderEmails.length === 0) return [];
  type Row = { id: string };
  type ContactRow = { company_id: string };
  // Distinct external mail domains among the stakeholder emails.
  // Feeds the third matcher below (companies.email_domain), which is
  // how a domain learned by the admin resolve action starts closing
  // the unmatched queue on subsequent inbound emails from the same
  // party.
  const domains = Array.from(
    new Set(
      stakeholderEmails
        .map((e) => e.toLowerCase().split('@')[1])
        .filter((d): d is string => !!d && d !== 'agsi.ae'),
    ),
  );
  const [companies, contacts, companiesByDomain] = await Promise.all([
    admin
      .from('companies')
      .select('id')
      .in('email', stakeholderEmails)
      .returns<Row[]>(),
    admin
      .from('contacts')
      .select('company_id')
      .is('deleted_at', null)
      .in('email', stakeholderEmails)
      .returns<ContactRow[]>(),
    domains.length > 0
      ? admin
          .from('companies')
          .select('id')
          .in('email_domain', domains)
          .returns<Row[]>()
      : Promise.resolve({ data: [] as Row[] }),
  ]);
  const ids = new Set<string>();
  for (const c of companies.data ?? []) ids.add(c.id);
  for (const c of contacts.data ?? []) ids.add(c.company_id);
  for (const c of companiesByDomain.data ?? []) ids.add(c.id);
  return Array.from(ids);
}

async function queueUnmatched(
  admin: ReturnType<typeof adminClient>,
  email: ParsedEmail,
  raw: Record<string, unknown>,
  receivedAt: string,
  reason: string,
) {
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
  if (unmErr) {
    return { error: unmErr.message };
  }

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
  return { ok: true as const };
}

async function storeAttachments(
  admin: ReturnType<typeof adminClient>,
  emailRowId: string,
  raw: Record<string, unknown>,
): Promise<{ stored: number; warnings: string[] }> {
  const warnings: string[] = [];
  const rawAttachments = Array.isArray(raw.Attachments) ? raw.Attachments : [];
  let stored = 0;
  for (const att of rawAttachments as Array<Record<string, unknown>>) {
    const name = typeof att.Name === 'string' ? att.Name : null;
    const contentType =
      typeof att.ContentType === 'string' ? att.ContentType : 'application/octet-stream';
    const content = typeof att.Content === 'string' ? att.Content : null;
    if (!name || !content) {
      warnings.push('skipped attachment with missing Name/Content');
      continue;
    }
    let bytes: Buffer;
    try {
      bytes = Buffer.from(content, 'base64');
    } catch {
      warnings.push(`base64 decode failed: ${name}`);
      continue;
    }
    const safeName = name.replace(/[/\\]/g, '_').slice(0, 200);
    const storagePath = `${emailRowId}/${safeName}`;
    const { error: upErr } = await admin.storage
      .from('email-attachments')
      .upload(storagePath, bytes, { contentType, upsert: false });
    if (upErr) {
      warnings.push(`upload failed for ${name}: ${upErr.message}`);
      continue;
    }
    const { error: metaErr } = await admin
      .from('engagement_email_attachments')
      .insert({
        engagement_email_id: emailRowId,
        filename: name,
        content_type: contentType,
        size_bytes: bytes.byteLength,
        storage_path: storagePath,
      });
    if (metaErr) {
      warnings.push(`metadata insert failed for ${name}: ${metaErr.message}`);
    } else {
      stored += 1;
    }
  }
  return { stored, warnings };
}

export async function POST(req: NextRequest) {
  const expected = process.env.INBOUND_EMAIL_SECRET;
  if (!expected) {
    return NextResponse.json({ error: 'Server not configured' }, { status: 500 });
  }
  const token = req.nextUrl.searchParams.get('token');
  if (token !== expected) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

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

  // Dedup
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

  const receivedAt = email.received_at
    ? new Date(email.received_at).toISOString()
    : new Date().toISOString();

  // 1. BD-user identification
  const allAddresses = Array.from(
    new Set([email.from_email, ...email.to_emails, ...email.cc_emails]),
  );
  const bdProfiles = await loadBdProfiles(admin, allAddresses);
  const bdSet = bdAddresses(bdProfiles);

  const systemAddress = (process.env.INBOUND_EMAIL_SYSTEM_ADDRESS ?? '')
    .toLowerCase()
    .trim();

  // 2-3. Classify direction and derive stakeholder emails
  const senderIsBd = bdSet.has(email.from_email);
  const direction: 'outbound' | 'inbound' = senderIsBd ? 'outbound' : 'inbound';

  function isStakeholder(addr: string): boolean {
    if (!addr) return false;
    if (bdSet.has(addr)) return false;
    if (systemAddress && addr === systemAddress) return false;
    return true;
  }
  const recipientStakeholders = [...email.to_emails, ...email.cc_emails].filter(isStakeholder);
  const stakeholderEmails = senderIsBd
    ? Array.from(new Set(recipientStakeholders))
    : Array.from(new Set([email.from_email, ...recipientStakeholders]));

  // 4. Company resolution
  const companyIds = await resolveCompanyIds(admin, stakeholderEmails);

  // Capture into a typed const so nested closures see the narrowed
  // non-null `email` (TS doesn't propagate outer-scope narrowing into
  // function declarations).
  const parsedEmail: ParsedEmail = email;
  async function queueAndRespond(reason: string) {
    const r = await queueUnmatched(admin, parsedEmail, raw, receivedAt, reason);
    if ('error' in r) {
      return NextResponse.json({ error: r.error }, { status: 500 });
    }
    return NextResponse.json({ ok: true, matched: false, reason, direction });
  }

  if (companyIds.length === 0) {
    return queueAndRespond('no company matched');
  }
  if (companyIds.length > 1) {
    return queueAndRespond('ambiguous — matches multiple companies');
  }

  const companyId = companyIds[0];

  // Attribution
  let createdBy: string | null;
  if (direction === 'outbound') {
    const senderProfile = findProfileForAddress(bdProfiles, email.from_email);
    createdBy = senderProfile?.id ?? null;
    if (!createdBy) {
      // Shouldn't happen — senderIsBd was true so a profile must exist —
      // but defensive.
      return queueAndRespond('outbound but sender profile id unresolved');
    }
  } else {
    // Inbound: attribute to the company owner. If unowned, queue.
    const { data: companyRow } = await admin
      .from('companies')
      .select('owner_id')
      .eq('id', companyId)
      .maybeSingle<{ owner_id: string | null }>();
    if (!companyRow?.owner_id) {
      return queueAndRespond('stakeholder unclaimed');
    }
    createdBy = companyRow.owner_id;
  }

  // 5. Create engagement + engagement_emails
  const { data: ins, error: insErr } = await admin
    .from('engagements')
    .insert({
      company_id: companyId,
      engagement_type: 'email',
      summary: `Email: ${email.subject.slice(0, 280)}`,
      engagement_date: receivedAt.slice(0, 10),
      created_by: createdBy,
    })
    .select('id')
    .single();
  if (insErr || !ins) {
    return NextResponse.json(
      { error: insErr?.message ?? 'engagement insert failed' },
      { status: 500 },
    );
  }

  const { data: emailRow, error: emailErr } = await admin
    .from('engagement_emails')
    .insert({
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
    })
    .select('id')
    .single<{ id: string }>();
  if (emailErr || !emailRow) {
    await admin.from('engagements').delete().eq('id', ins.id);
    return NextResponse.json(
      { error: emailErr?.message ?? 'email insert failed' },
      { status: 500 },
    );
  }

  const { stored, warnings } = await storeAttachments(admin, emailRow.id, raw);

  return NextResponse.json({
    ok: true,
    matched: true,
    engagement_id: ins.id,
    attachments_stored: stored,
    attachment_warnings: warnings,
    direction,
  });
}

export async function GET() {
  return NextResponse.json({ ok: true, service: 'inbound-email' });
}

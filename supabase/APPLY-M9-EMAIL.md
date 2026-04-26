# Email tracking — inbound email pipeline

The CRM accepts inbound emails via a webhook and turns them into
engagement rows attached to the right company. BD users CC or BCC a
single tracking address on every email to a stakeholder; the matcher
auto-links by sender + recipient lookup against `profiles.email` and
`companies.email` / `companies.key_contact_email`.

This is a one-time setup. After it's done, the only behavioral change
for BD users is "remember to BCC the engagement address" — easy with a
Gmail/Outlook auto-BCC filter rule.

## Step 1 — Apply migration `0032_email_tracking.sql`

Adds:
- `engagement_emails` — per-engagement email metadata (message_id,
  from, to, cc, subject, body, direction).
- `inbound_email_unmatched` — admin review queue for emails the
  auto-matcher couldn't link.
- `resolve_inbound_email()` RPC — admin resolves an unmatched email
  by picking the right company; creates the engagement + email rows.

1. Open https://github.com/walidgsherif-wq/agsi-crm/blob/claude/resume-agsi-crm-build-TQ28J/supabase/migrations/0032_email_tracking.sql
2. Click **Raw** → select all → copy
3. Supabase SQL Editor → **New query** → paste → **Run**
4. Expect: `Success. No rows returned.`

## Step 2 — Set the inbound webhook secret

Generate a long random string (Vercel will accept anything; treat it
like a password):

```
openssl rand -hex 32
```

…or just bash anything together. Then in **Vercel → Project → Settings
→ Environment Variables**, add:

| Name | Value |
|---|---|
| `INBOUND_EMAIL_SECRET` | the random string |

Redeploy (Vercel will prompt automatically). The webhook URL becomes
`https://agsi-crm.vercel.app/api/inbound-email?token=<the-secret>`.

## Step 3 — Pick an inbound email provider

Recommended: **Postmark Inbound** (https://postmarkapp.com/email-inbound).
Why: 5-min setup, free up to 10k emails/month, JSON webhook with the
exact shape my parser expects, mature.

Alternatives we'd accept later: SendGrid Inbound Parse, AWS SES + Lambda,
Cloudflare Email Routing → Worker. The `route.ts` has a `fromGeneric`
adapter path so any service can post a normalised JSON payload.

### Postmark setup walk-through

1. Sign up at https://postmarkapp.com (free tier).
2. Postmark dashboard → **Servers** → click your server (or create one).
3. Inside the server → **Inbound Stream** (left sidebar).
4. **Inbound webhook URL**: paste
   `https://agsi-crm.vercel.app/api/inbound-email?token=<the-secret>`
   from Step 2.
5. **Save**. Postmark will generate an inbound address like
   `<random-id>@inbound.postmarkapp.com`. You can either:
   - Forward your own engagement address (e.g. `engagements@bd.agsi.ae`)
     to that Postmark address using your DNS provider's email forwarding,
     OR
   - Set up an MX record on a domain you control pointing at
     `inbound.postmarkapp.com` and use the local part to route.

Easiest path: register a domain you control (or use a subdomain), set
up an MX → Postmark, and tell BD users to BCC that address.

## Step 4 — Test it

In Postmark dashboard → Inbound stream → **Send test email** (or just
send a real email to your inbound address from your own inbox). Within
a few seconds, the webhook fires.

In the CRM:
1. Open `/admin/inbound-email`. The email should land here as
   "pending" (because for the first test, the From and To probably
   don't match anyone in the DB).
2. Pick a company from the dropdown → **Resolve & create engagement**.
3. Open that company's Engagements tab. The email shows as a new
   engagement of type "Email".

## Step 5 — Train the auto-matcher

Once you start sending real emails through:

1. Make sure each BD user's email in `/admin/users` matches the address
   they actually send from (e.g. `walid@agsi.ae` not the Gmail used at
   bootstrap).
2. Make sure each company's `key_contact_email` is populated — that's
   the matcher's lookup key. Edit via `/companies/[id]` Overview tab.
3. After a few emails are processed, the auto-match rate should hit
   ~90%+. Anything that lands in the unmatched queue is usually a
   missing key contact.

## Step 6 — Tell BD users about auto-BCC

Add an auto-BCC filter so users never forget:

### Gmail
1. Settings → **Filters and Blocked Addresses** → **Create a new filter**
2. **To** field: leave empty
3. **From** field: their own AGSI email
4. Click **Create filter**
5. Tick **Forward it to** (or use the Gmail "BCC"-via-filter trick by
   adding the engagement address as an additional recipient via a Gmail
   add-on like *Send From Gmail* — Gmail's native filters don't BCC
   directly).

Cleaner alternative: install the *Add CC/BCC by Default* Chrome
extension or use Gmail Send-Mail-As.

### Outlook
1. Outlook desktop → File → **Manage Rules & Alerts**
2. **New Rule** → **Apply rule on messages I send**
3. Action: **Cc the message to people or public group** → add the
   engagement address
4. Save & enable.

## What gets captured

Every email cc'd / bcc'd to the engagement address creates an
engagement row of type `email` on the matching company. The
engagement_emails row stores subject, body (text + html), all
recipients, and the raw provider payload for debugging.

Replies from the stakeholder also get captured if they reply-all or if
the BD user forwards the reply to the engagement address.

## What's NOT captured (intentionally)

- Attachments — for v1, `has_attachments` flag is set but the actual
  file bytes aren't stored. Postmark + the Storage bucket integration
  for attachments lands in a follow-up.
- Inline images — same as attachments.
- Calendar invites — not yet.

## Reply to me

- **"verified"** + your inbound webhook URL + your provider choice — I
  flip the README and we move to M10 (or whatever's next).
- A specific bug in the auto-matcher (e.g. "I sent an email and it
  didn't appear") — paste the entry from `/admin/inbound-email` and
  I'll diagnose.

# v1.1 — Inbound email attachments + configurable BCC address

Two ends of the same loop, shipped together:

1. **Attachments** — Postmark inbound payloads now have their attachment
   bytes stored in Supabase Storage. The placeholder
   `had attachments (file bytes not stored in v1)` in the engagement
   sheet is replaced with a real list of download links.
2. **BCC address** — admin sets an `inbound_email_address` (e.g.
   `log@yourdomain.com`) once, and pipeline cold-card hints
   automatically tell the team to BCC that address to keep cards
   warm. Closes the engagement-glow loop end-to-end.

## Step 1 — Apply migration `0049_email_attachments.sql`

Idempotent (every `CREATE` uses `IF NOT EXISTS`, bucket insert is
`ON CONFLICT DO NOTHING`, seed `INSERT` uses `ON CONFLICT DO
NOTHING`). Safe to re-run.

1. Open the raw file:
   https://raw.githubusercontent.com/walidgsherif-wq/AGSI-CRM/main/supabase/migrations/0049_email_attachments.sql
2. Select all → copy → paste into Supabase **SQL Editor** → **Run**.
3. Expect "Success. No rows returned."

## Step 2 — Set the BCC address

Once you've finished the Postmark forwarder setup (per
`supabase/APPLY-M9-EMAIL.md`):

1. Sidebar → **Admin → Settings**.
2. Scroll to the new **Inbound email** card.
3. Type the address you want the team to BCC (e.g.
   `log@yourdomain.com`) → **Save**.

Pipeline cold-card hints will immediately switch from the generic
copy to:
> No recent activity — log a touchpoint or BCC **log@yourdomain.com**
> on client emails.

Leave the field empty if you're not ready — the generic copy
returns automatically.

## Step 3 — Verify attachments end-to-end

1. Send yourself a test email with one or two small attachments (PDF,
   image) BCC'd to your inbound address.
2. After Postmark posts the webhook (~30 s), open the matched
   company's engagements page → click the new email engagement → the
   **Attachments** row now lists each file with a click-to-download
   link (signed URL, 1-hour expiry).

## Size limits (important)

- **Per-file cap: 5 MB** (storage bucket policy).
- **Per-webhook total: ~3 MB raw** (Vercel's 4.5 MB serverless body
  limit, less ~33% base64 overhead).

Larger attachments are skipped with a warning in the webhook response
and `attachment_warnings` lands in the inbound webhook log. The
engagement row + email row are still created — the warning just
notes which files didn't make it. If you regularly need to log very
large attachments via email, tell me and I'll wire a per-file fetch
path against the Postmark API (no body-size limit) in a follow-up.

## Verify in SQL

```sql
-- Recent inbound emails with attachment counts
SELECT ee.subject,
       ee.received_at,
       COUNT(eea.id)                                AS attachments,
       SUM(eea.size_bytes)                          AS total_bytes
  FROM engagement_emails ee
  LEFT JOIN engagement_email_attachments eea
    ON eea.engagement_email_id = ee.id
 GROUP BY ee.id
 ORDER BY ee.received_at DESC
 LIMIT 20;
```

```sql
-- Confirm bucket exists and is private
SELECT id, public, file_size_limit
  FROM storage.buckets
 WHERE id = 'email-attachments';
```

## Reply

- **"attachments verified"** → I move to the next item.
- If anything's off, paste the failing email's row and I'll dig.

# v1.1 #3 — Persist finalised PDF to Supabase Storage

Finalising a leadership report now renders the PDF server-side and
uploads the bytes to a private `leadership-reports` bucket. The
public download URL stays the same (`/api/reports/leadership/[id]/pdf`)
but for finalised reports it 302-redirects to a 60s signed URL, so
downloads serve the immutable bytes captured at finalise time
instead of re-rendering on every click.

## Step 1 — Apply migration `0046_leadership_reports_bucket.sql`

This creates the private `leadership-reports` storage bucket
(50 MB cap, PDFs only) and four RLS policies on `storage.objects`
scoped to that bucket: admin write, admin/bd_head/leadership read.

1. https://github.com/walidgsherif-wq/AGSI-CRM/blob/claude/v11-pdf-persist-storage/supabase/migrations/0046_leadership_reports_bucket.sql
2. Click **Raw** → select all → copy.
3. Supabase SQL Editor → **New query** → paste → **Run**.
4. Expect: `Success. No rows returned.`

To verify the bucket exists: Dashboard → **Storage** → you should see
`leadership-reports` listed (private).

## Step 2 — Merge + auto-promote

Vercel auto-promotes from `main`.

## Step 3 — Try it

1. Sidebar → **Admin → Reports** → create a new draft report (or
   open an existing draft).
2. Click **Finalise & Send to Leadership**. The button now warns
   you that a PDF snapshot will be captured.
3. Wait ~5–10s while the PDF renders + uploads.
4. Refresh — the report status flips to **finalised** and a new
   **PDF snapshot** card appears with a green **Persisted** badge.
5. Open the public detail page (`/reports/leadership/{id}`) → click
   **Download PDF**. Network tab should show a 302 to a signed URL
   like `https://<project>.supabase.co/storage/v1/object/sign/leadership-reports/...`.

If the auto-render fails (e.g. transient @react-pdf timeout), you'll
see an amber warning under the Finalise button reading
*"Finalised, but PDF persist failed"*. Open the report in admin
edit mode → **PDF snapshot** card → **Regenerate PDF** to retry.

## Verify in SQL Editor

```sql
SELECT id, period_label, status, finalised_at, pdf_storage_path
  FROM leadership_reports
 WHERE status IN ('finalised','archived')
 ORDER BY finalised_at DESC NULLS LAST
 LIMIT 10;
```

Recently finalised rows should have a non-null `pdf_storage_path`
matching `<report_id>/leadership-<safe-period-label>.pdf`.

```sql
SELECT bucket_id, name, owner, created_at, metadata->>'mimetype' AS mime
  FROM storage.objects
 WHERE bucket_id = 'leadership-reports'
 ORDER BY created_at DESC
 LIMIT 10;
```

The bytes themselves are visible here, owned by the finalising admin's
user_id.

## Reply to me

- **"v1.1 PDF persist verified"** → I move to v1.1 #4 (inbound email
  attachments).
- A specific glitch — paste what you see, especially the JSON
  response from the finalise action and any error in the Storage
  policy logs.

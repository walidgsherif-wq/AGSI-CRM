# §17.5b — Inbound Email Pipeline Sequence Diagram (M9)

Covers the inbound email tracking flow added in M9. The user pattern is
"BD users CC/BCC a tracking address on every stakeholder email"; the
diagram below shows what happens between the inbound provider receiving
that email and an `engagements` row appearing on the right company.

Renders in any Markdown viewer that supports Mermaid (GitHub, VS Code,
Obsidian).

```mermaid
sequenceDiagram
    autonumber
    actor BD as BD user
    actor Stake as Stakeholder
    participant Inbox as Mail server<br/>(Gmail / Outlook)
    participant Filter as Auto-BCC filter<br/>(Gmail / Outlook rule)
    participant Provider as Postmark Inbound
    participant API as Next.js webhook<br/>(/api/inbound-email)
    participant DB as Postgres
    participant Admin as Admin
    participant UI as Admin UI<br/>(/admin/inbound-email)

    BD->>Inbox: send email "Meeting recap" → stakeholder
    Inbox->>Filter: outgoing message
    Filter->>Inbox: add Bcc: <inbound-id>@inbound.postmarkapp.com
    Inbox->>Provider: deliver to inbound address
    Provider->>API: POST parsed-JSON payload<br/>?token=<INBOUND_EMAIL_SECRET>

    API->>API: token check<br/>(401 if mismatch)
    API->>API: parseBody — Postmark adapter<br/>or generic shape
    API->>DB: SELECT engagement_emails<br/>WHERE message_id = ?
    alt already stored
        DB-->>API: hit → return {ok:true, deduped:true}
    else new message
        DB-->>API: miss

        rect rgba(43,108,176,0.08)
        Note over API,DB: Match phase
        API->>DB: SELECT profile WHERE email = from_email
        alt profile match (BD outbound)
            DB-->>API: bd_user_id
            API->>API: scan to_emails + cc_emails<br/>for stakeholder addresses
            API->>DB: SELECT companies WHERE<br/>email IN (...) OR key_contact_email IN (...)
        else no profile match
            API->>API: scan recipients for any profile<br/>(stakeholder reply case)
            API->>DB: SELECT companies WHERE<br/>email = from_email OR key_contact_email = from_email
        end
        end

        alt company resolved
            rect rgba(46,125,82,0.08)
            Note over API,DB: Happy path
            API->>DB: BEGIN<br/>INSERT engagements (type='email', summary='Email: '||subject)
            DB-->>API: engagement_id
            API->>DB: INSERT engagement_emails<br/>(message_id UNIQUE, body_text, body_html, raw_payload)
            alt insert succeeds
                API->>DB: COMMIT
                API-->>Provider: 200 {ok:true}
            else insert fails
                API->>DB: ROLLBACK engagement
                API-->>Provider: 500
            end
            end
        else no company match
            rect rgba(221,142,42,0.08)
            Note over API,DB: Unmatched queue
            API->>DB: INSERT inbound_email_unmatched<br/>(status='pending', reason)
            API-->>Provider: 200 {ok:true, queued:true}
            API->>DB: enqueue admin notification<br/>(notifications table)
            end
        end
    end

    Stake->>Inbox: reply-all (optional)
    Inbox->>Provider: copy via reply-all to inbound address
    Provider->>API: POST again — direction='inbound'
    Note over API: same flow; from_email no<br/>longer matches a profile, so<br/>company match is via from_email

    Admin->>UI: open /admin/inbound-email
    UI->>DB: SELECT inbound_email_unmatched<br/>WHERE status='pending'
    DB-->>UI: queue rows
    Admin->>UI: pick a company → "Resolve & create engagement"
    UI->>DB: CALL resolve_inbound_email(unmatched_id, company_id, acting_user, note)
    DB->>DB: INSERT engagements + engagement_emails<br/>(direction inferred from sender)
    DB->>DB: UPDATE inbound_email_unmatched<br/>SET status='resolved', resolved_engagement_id, resolved_by
    DB-->>UI: engagement_id
    UI-->>Admin: row moves to "Resolved" tab
```

## What's not in v1 (intentionally deferred)

- **Attachments**: `engagement_emails.has_attachments` flag is set when
  the provider reports any attachment, but file bytes are not stored. A
  follow-up will pull attachments from the provider into the documents
  bucket and link them to the engagement.
- **Inline images**: same as attachments. The sanitised HTML body still
  carries `<img>` tags pointing at provider URLs; those may stop working
  after the provider's retention window.
- **Calendar invites**: not parsed.
- **Threading**: each email is a standalone engagement. Conversation
  threading (`In-Reply-To` / `References` headers) lands when there's a
  user need.

## Authentication model

The webhook is exposed publicly at `/api/inbound-email` and authenticated
solely by a query-string token compared against `INBOUND_EMAIL_SECRET`.
Rotating the secret is a Vercel env var change + a Postmark inbound URL
update — no schema migration required. Token is sent as a query-string
param (not a header) because Postmark Inbound only allows specifying the
URL, not custom headers.

## Why a webhook, not polling

- Postmark / SES / SendGrid are push-only — there's no inbound IMAP
  endpoint to poll against without an extra integration layer.
- Push gives sub-second latency from email send to engagement row
  visible in the CRM.
- The webhook handler is stateless; multiple concurrent invocations are
  safe because dedup is enforced by the `message_id` UNIQUE index on
  both `engagement_emails` and `inbound_email_unmatched`.

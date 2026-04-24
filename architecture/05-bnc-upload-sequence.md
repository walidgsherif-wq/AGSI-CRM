# §17.5 — BNC Upload Pipeline Sequence Diagram

Covers the full flow described in prompt §4. Renders in any Markdown viewer
that supports Mermaid (GitHub, VS Code, Obsidian).

```mermaid
sequenceDiagram
    autonumber
    actor Admin
    participant UI as Next.js UI<br/>(/admin/uploads)
    participant Storage as Supabase Storage<br/>(bnc-uploads/)
    participant DB as Postgres
    participant Fn as Edge Function<br/>bnc-upload-process
    participant Notif as Notification svc
    participant Email as Resend

    Admin->>UI: Drag-drop BNC_Project_DDMMYYYY.xlsx
    UI->>UI: Validate filename pattern, ext, size
    UI->>Storage: PUT file (service-role presigned)
    Storage-->>UI: storage_path
    UI->>DB: INSERT bnc_uploads<br/>{status:'pending', file_date, storage_path}
    DB-->>UI: upload_id
    UI->>Fn: invoke(upload_id) [async]
    UI-->>Admin: "Processing…" row in upload history

    Fn->>DB: UPDATE bnc_uploads SET status='processing'
    Fn->>Storage: GET file
    Storage-->>Fn: xlsx bytes

    rect rgba(43,108,176,0.08)
    Note over Fn: Stage A — parse<br/>header row = index 1 (row 2)
    Fn->>Fn: parse rows; reject if header missing<br/>→ status='failed' + error_log
    Fn->>DB: INSERT bnc_upload_rows (batches of 500)
    end

    rect rgba(46,125,82,0.08)
    Note over Fn,DB: Stage B — project resolver (§4.2)
    loop each row
        Fn->>DB: SELECT project WHERE bnc_reference_number = ?
        alt exists
            Fn->>DB: UPDATE project (mutable fields, last_seen_*, is_dormant=false)
        else
            Fn->>DB: INSERT project (stage mapped via §4.2 table)
        end
        Fn->>DB: UPDATE bnc_upload_rows.resolved_project_id
    end
    end

    rect rgba(107,79,158,0.08)
    Note over Fn,DB: Stage C — company resolver (§4.3)<br/>6 role columns × N tokens per cell
    loop each (row, role_column, token)
        Fn->>Fn: skip "Not yet awarded", "TBA", etc
        Fn->>Fn: normalise (strip PJSC/LLC/etc; keep raw)
        Fn->>DB: similarity(canonical_name + aliases, token)
        alt sim >= 0.85
            Fn->>DB: UPSERT project_companies;<br/>append alias if new
        else 0.75 <= sim < 0.85
            Fn->>DB: INSERT company_match_queue<br/>{status:'pending'}
        else sim < 0.75
            Fn->>DB: INSERT companies<br/>(source='bnc_upload', current_level='L0', owner_id=NULL)
            Fn->>DB: INSERT project_companies
        end
    end
    Fn->>DB: UPDATE project_companies<br/>SET is_current=false WHERE last_seen_in_upload_id <> :this
    end

    rect rgba(212,175,55,0.08)
    Note over Fn,DB: Stage D — derived state
    Fn->>DB: UPDATE companies.has_active_projects<br/>(true where appears in ≥ 1 project this upload)
    Fn->>DB: UPDATE projects SET is_dormant=true<br/>WHERE missed ≥ 2 consecutive uploads
    end

    rect rgba(31,60,110,0.08)
    Note over Fn,DB: Stage E — market snapshot (§4.4)
    Fn->>DB: INSERT market_snapshots (by-stage, by-city, top-20s, funnel, etc)
    end

    Fn->>DB: UPDATE bnc_uploads<br/>SET status='completed', new_projects, updated_projects,<br/>dormant_projects, new/matched/unmatched_companies
    Fn->>Notif: enqueue 'upload_complete' for all admins
    Notif->>DB: INSERT notifications
    Notif->>Email: immediate send if 'unmatched_company' count > 0
    Notif-->>UI: Realtime push → notification bell

    UI-->>Admin: Upload summary screen<br/>(new/updated/dormant/unmatched counts)

    alt any stage throws
        Fn->>DB: UPDATE bnc_uploads SET status='failed', error_log=<msg>
        Fn->>Notif: enqueue 'upload_failed' (immediate email)
    end
```

## Edge-case branches encoded above

- **Duplicate upload** (same `file_date`): UI-layer check before the `INSERT bnc_uploads`
  raises a blocking dialog. Admin must tick "reprocess intentional" to proceed.
  Not shown in the diagram to keep the happy path legible.
- **Empty file / no header row**: Stage A fails fast; no row insertion, no
  resolver stages run.
- **Unknown stage string**: project resolver maps to `concept` and logs an
  admin-visible flag in `bnc_upload_rows.raw_data.stage_map_warning`.
- **Role-column cell with 3 comma-separated companies**: tokenised in Stage C
  loop; each resolved independently.

## Why Edge Function, not server action

- 3,500-row files blow past Vercel's 60s server-action timeout on some stages.
- Supabase Edge Functions can run 150s on free tier, unbounded on paid — more
  headroom for the 60s target in §13.
- Keeps the heavy insert traffic inside the Supabase network (no egress).

# §17.3 — RLS Policy Matrix (role × table × operation)

This document is the **single source of truth** for access control. Migration
`0022_rls_policies.sql` implements the matrix below line-for-line. Any
deviation between matrix and migration is a bug.

## Legend

| Symbol | Meaning |
|--------|---------|
| ✅ | Allowed unconditionally |
| 🔒 own | Allowed only for rows the user owns (`owner_id = auth.uid()` or equivalent) |
| 🔒 self | Allowed only for rows where the user is the subject (`id = auth.uid()`) |
| 🟡 column | Allowed but restricted to specific columns (enforced via BEFORE UPDATE trigger) |
| ❌ | Denied |
| n/a | Table doesn't exist for this role's workflow |

## Canonical roles

- `admin` — operations super-user (§2)
- `leadership` — SELECT-only oversight + feedback on reports (§2, §3.17)
- `bd_head` — team-wide operational (§2)
- `bd_manager` — individual contributor, own-records only (§2)

Every policy below is written against `profiles.role` resolved for `auth.uid()`.
A helper SQL function `auth_role()` is defined in `0021_functions_triggers.sql`
and referenced throughout.

---

## 1. Identity & config tables

| Table | Op | admin | leadership | bd_head | bd_manager |
|-------|----|-------|------------|---------|------------|
| `profiles` | SELECT | ✅ | ✅ | ✅ | 🔒 self + all active colleagues (name/email/role) |
| `profiles` | INSERT | ✅ (invite flow) | ❌ | ❌ | ❌ |
| `profiles` | UPDATE | ✅ | 🟡 self: `full_name`, `phone_e164` only | 🟡 self | 🟡 self |
| `profiles` | DELETE | ❌ (use `is_active=false`) | ❌ | ❌ | ❌ |
| `app_settings` | SELECT | ✅ | ✅ (read-only oversight) | ✅ | ✅ (non-sensitive keys only — see note A) |
| `app_settings` | INSERT/UPDATE/DELETE | ✅ | ❌ | ❌ | ❌ |
| `audit_events` | SELECT | ✅ | ❌ | ❌ | ❌ |
| `audit_events` | INSERT | ✅ (server-only via service role; RLS denies user INSERTs — rows written by SECURITY DEFINER functions) | n/a | n/a | n/a |
| `audit_events` | UPDATE/DELETE | ❌ | ❌ | ❌ | ❌ |

**Note A** — `bd_manager` SELECT on `app_settings` is filtered by a policy that
only returns non-sensitive keys (`notification_channels_enabled`,
`fiscal_year_start_month`, freshness thresholds). Sensitive rows
(`bei_weightings`, `ecosystem_*`, `kpi_universe_sizes`) are hidden. Implemented
as a `USING` predicate on the key whitelist.

---

## 2. Core CRM tables

| Table | Op | admin | leadership | bd_head | bd_manager |
|-------|----|-------|------------|---------|------------|
| `companies` | SELECT | ✅ | ✅ | ✅ | ✅ |
| `companies` | INSERT | ✅ | ❌ | ✅ | ✅ (owner_id defaults to self) |
| `companies` | UPDATE | ✅ | ❌ | ✅ | 🔒 own |
| `companies` | DELETE | ✅ (with blocking check: no engagements/tasks) | ❌ | ❌ | ❌ |
| `projects` | SELECT | ✅ | ✅ | ✅ | ✅ |
| `projects` | INSERT | ✅ | ❌ | ✅ | ✅ |
| `projects` | UPDATE | ✅ | ❌ | ✅ (internal notes + priority) | ✅ (internal notes + priority) |
| `projects` | DELETE | ✅ | ❌ | ❌ | ❌ |
| `project_companies` | SELECT | ✅ | ✅ | ✅ | ✅ |
| `project_companies` | INSERT/UPDATE/DELETE | ✅ | ❌ | ✅ | ✅ |
| `engagements` | SELECT | ✅ | ✅ (summary fields only — note B) | ✅ | ✅ |
| `engagements` | INSERT | ✅ | ❌ | ✅ | ✅ (`created_by` must = self) |
| `engagements` | UPDATE | ✅ | ❌ | ✅ | 🔒 own (`created_by = self` OR `companies.owner_id = self`) |
| `engagements` | DELETE | ✅ | ❌ | ✅ own | 🔒 own |
| `tasks` | SELECT | ✅ | ❌ | ✅ | ✅ |
| `tasks` | INSERT | ✅ | ❌ | ✅ | ✅ |
| `tasks` | UPDATE | ✅ | ❌ | ✅ | 🔒 own |
| `tasks` | DELETE | ✅ | ❌ | 🔒 own | 🔒 own |
| `notes` | SELECT | ✅ | ❌ (leadership doesn't need BDM chatter) | ✅ | ✅ |
| `notes` | INSERT | ✅ | ❌ | ✅ | ✅ (`author_id = self`) |
| `notes` | UPDATE | ✅ | ❌ | 🔒 own (`author_id = self`) | 🔒 own |
| `notes` | DELETE | ✅ | ❌ | 🔒 own | 🔒 own |
| `documents` | SELECT | ✅ | ✅ (metadata only — note C) | ✅ | ✅ |
| `documents` | INSERT | ✅ | ❌ | ✅ | ✅ |
| `documents` | UPDATE | ✅ | ❌ | ✅ | 🔒 own (`uploaded_by = self`) |
| `documents` | DELETE | ✅ | ❌ | 🔒 own | 🔒 own |

**Note B** — `engagements` columns `summary` and `engagement_date` are visible
to leadership; `triggered_level_change_id` also visible. No other column
restriction — leadership sees full engagement content. "Summary fields only"
in the prompt is interpreted as: engagements exist as evidence rows, not as a
free-text stream to mine. No sensitive column here.

**Note C** — `documents` expose all metadata to leadership. Signed URLs to
download files are generated per-request via the storage layer, which checks
role again server-side.

---

## 3. Level history (scoring ledger)

| Table | Op | admin | leadership | bd_head | bd_manager |
|-------|----|-------|------------|---------|------------|
| `level_history` | SELECT | ✅ | ✅ | ✅ | ✅ |
| `level_history` | INSERT | ❌ direct — **only** via `change_company_level()` SECURITY DEFINER fn | ❌ | ❌ direct — via fn | ❌ direct — via fn |
| `level_history` | UPDATE | ✅ (admin may toggle `is_credited` only — enforced by column-mask trigger) | ❌ | ❌ | ❌ |
| `level_history` | DELETE | ❌ (immutable ledger — use `is_credited=false`) | ❌ | ❌ | ❌ |

`companies.current_level` has a BEFORE UPDATE trigger that rejects direct
writes outside the `change_company_level()` function. This guarantees every
level change produces a corresponding `level_history` row.

---

## 4. KPI, targets, composition, BEI

| Table | Op | admin | leadership | bd_head | bd_manager |
|-------|----|-------|------------|---------|------------|
| `playbook_targets` | SELECT | ✅ | ✅ | ✅ | ✅ |
| `playbook_targets` | INSERT/UPDATE | ✅ | ❌ | ❌ | ❌ |
| `playbook_targets` | DELETE | ❌ (never) | ❌ | ❌ | ❌ |
| `member_targets` | SELECT | ✅ | ✅ | ✅ | 🔒 self (`user_id = auth.uid()`) |
| `member_targets` | INSERT | ✅ | ❌ | ❌ | ❌ |
| `member_targets` | UPDATE | ✅ | ❌ | ❌ | ❌ |
| `member_targets` | DELETE | ✅ (reset to playbook = delete override) | ❌ | ❌ | ❌ |
| `kpi_actuals_daily` | SELECT | ✅ | ✅ | ✅ | 🔒 self + team rollup rows (`user_id = self OR user_id IS NULL`) |
| `kpi_actuals_daily` | INSERT/UPDATE/DELETE | ❌ direct — rebuilt by function only | ❌ | ❌ | ❌ |
| `composition_drift_log` | SELECT | ✅ | ✅ | ✅ | 🔒 self |
| `composition_drift_log` | INSERT/UPDATE/DELETE | ❌ direct | ❌ | ❌ | ❌ |
| `bei_current_view` (matview) | SELECT | ✅ | ✅ | ✅ | 🔒 self |
| `bei_current_view` | any write | ❌ (refreshed by function) | ❌ | ❌ | ❌ |

**Note** — §2 of the prompt says bd_manager has "no access to `member_targets`".
Interpretation: no write access. Read access to **own** targets is required
for the BDM dashboard to render KPI tiles against targets. Matrix reflects
this; if stricter is required, drop `bd_manager` SELECT on `member_targets`
and render the dashboard via a SECURITY DEFINER view instead.

---

## 5. BNC pipeline

| Table | Op | admin | leadership | bd_head | bd_manager |
|-------|----|-------|------------|---------|------------|
| `bnc_uploads` | SELECT | ✅ | ❌ | ❌ | ❌ |
| `bnc_uploads` | INSERT/UPDATE/DELETE | ✅ | ❌ | ❌ | ❌ |
| `bnc_upload_rows` | SELECT | ✅ | ❌ | ❌ | ❌ |
| `bnc_upload_rows` | INSERT/UPDATE/DELETE | ✅ (server-only) | ❌ | ❌ | ❌ |
| `company_match_queue` | SELECT | ✅ | ❌ | ❌ | ❌ |
| `company_match_queue` | all writes | ✅ | ❌ | ❌ | ❌ |
| `market_snapshots` | SELECT | ✅ | ✅ | ✅ | ✅ |
| `market_snapshots` | any write | ✅ (server-only) | ❌ | ❌ | ❌ |

---

## 6. Stagnation, notifications, settings

| Table | Op | admin | leadership | bd_head | bd_manager |
|-------|----|-------|------------|---------|------------|
| `stagnation_rules` | SELECT | ✅ | ✅ | ✅ | ✅ |
| `stagnation_rules` | INSERT/UPDATE/DELETE | ✅ | ❌ | ❌ | ❌ |
| `notifications` | SELECT | 🔒 self (admin still scoped to own inbox; admin sees all via audit) | 🔒 self | 🔒 self | 🔒 self |
| `notifications` | INSERT | ❌ direct (written by server functions) | ❌ | ❌ | ❌ |
| `notifications` | UPDATE | 🔒 self (mark-read only — column trigger) | 🔒 self | 🔒 self | 🔒 self |
| `notifications` | DELETE | ❌ | ❌ | ❌ | ❌ |

---

## 7. Ecosystem Awareness (§3.16 — leadership-visibility metric)

Critical: `bd_manager` must be **fully blocked** at RLS. Not hidden at the UI
layer — blocked in the database.

| Table | Op | admin | leadership | bd_head | bd_manager |
|-------|----|-------|------------|---------|------------|
| `ecosystem_events` | SELECT | ✅ | ✅ | ✅ | ❌ |
| `ecosystem_events` | any write | ❌ direct (rebuilt by function) | ❌ | ❌ | ❌ |
| `ecosystem_point_scale` | SELECT | ✅ | ✅ | ✅ | ❌ |
| `ecosystem_point_scale` | INSERT/UPDATE | ✅ | ❌ | ❌ | ❌ |
| `ecosystem_point_scale` | DELETE | ❌ | ❌ | ❌ | ❌ |
| `ecosystem_awareness_current` | SELECT | ✅ | ✅ | ✅ | ❌ |
| `ecosystem_awareness_current` | any write | ❌ direct | ❌ | ❌ | ❌ |

---

## 8. Leadership Reports (§3.17)

| Table | Op | admin | leadership | bd_head | bd_manager |
|-------|----|-------|------------|---------|------------|
| `leadership_reports` | SELECT | ✅ all | ✅ `status IN ('finalised','archived')` only | ✅ `status IN ('finalised','archived')` only | ❌ |
| `leadership_reports` | INSERT | ✅ | ❌ | ❌ | ❌ |
| `leadership_reports` | UPDATE | ✅ (any column on `draft`; feedback fields not admin-editable) | 🟡 **only** `leadership_feedback_text`, and only on `finalised` rows — column-mask trigger sets `leadership_feedback_by = auth.uid()` and `leadership_feedback_at = now()` server-side | ❌ | ❌ |
| `leadership_reports` | DELETE | ❌ (never — use `archived`) | ❌ | ❌ | ❌ |
| `leadership_report_stakeholders` | SELECT | ✅ | ✅ (via parent report visibility) | ✅ | ❌ |
| `leadership_report_stakeholders` | any write | ✅ (server-only at generate time) | ❌ | ❌ | ❌ |

Column-mask for `leadership` UPDATE is critical. Implementation in
`0021_functions_triggers.sql`:

```sql
CREATE FUNCTION enforce_leadership_feedback_only() RETURNS trigger AS $$
BEGIN
  IF auth_role() = 'leadership' THEN
    -- Only these three columns may change
    IF ROW(NEW.id, NEW.report_type, NEW.period_label, NEW.period_start, NEW.period_end,
           NEW.fiscal_year, NEW.fiscal_quarter, NEW.generated_by, NEW.generated_at,
           NEW.status, NEW.finalised_at, NEW.finalised_by, NEW.payload_json,
           NEW.executive_summary, NEW.pdf_storage_path)
       IS DISTINCT FROM
       ROW(OLD.id, OLD.report_type, OLD.period_label, OLD.period_start, OLD.period_end,
           OLD.fiscal_year, OLD.fiscal_quarter, OLD.generated_by, OLD.generated_at,
           OLD.status, OLD.finalised_at, OLD.finalised_by, OLD.payload_json,
           OLD.executive_summary, OLD.pdf_storage_path)
    THEN
      RAISE EXCEPTION 'leadership may only update feedback fields';
    END IF;
    -- Stamp the bylines server-side (never trust client)
    NEW.leadership_feedback_by := auth.uid();
    NEW.leadership_feedback_at := now();
    -- Only editable when report is finalised
    IF NEW.status <> 'finalised' THEN
      RAISE EXCEPTION 'leadership feedback only on finalised reports';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
```

---

## 9. Heat-map supporting data

| Table | Op | admin | leadership | bd_head | bd_manager |
|-------|----|-------|------------|---------|------------|
| `city_lookup` | SELECT | ✅ | ✅ | ✅ | ❌ (blocked — heat-map data not accessible) |
| `city_lookup` | INSERT/UPDATE/DELETE | ✅ | ❌ | ❌ | ❌ |

Per §7.5: heat maps are blocked for `bd_manager` to avoid reverse-engineering
ecosystem data. Blocking `city_lookup` at RLS prevents even raw query access
to the lookup that powers the geographic map.

---

## 10. Storage bucket policies

Not strictly RLS but noted here for completeness; implemented in
`0022_rls_policies.sql` as `storage.objects` policies.

| Bucket | Visibility | Upload | Read | Delete |
|--------|-----------|--------|------|--------|
| `bnc-uploads/` | private | admin | admin | admin |
| `documents/` | private | admin, bd_head, bd_manager (own) | any authenticated via signed URL (signed by server after role check) | admin, owner |
| `leadership-reports/` | private | server (service role) only | admin, leadership, bd_head via signed URL | ❌ (never) |
| `evidence/` (level-change evidence files) | private | admin, bd_head, bd_manager | admin, bd_head, bd_manager, leadership | admin, owner |

All signed URLs expire in **15 minutes** (§14).

---

## Test obligations

Milestone 2 ships with Playwright tests that assert the **negative path** for
each role:

- `bd_manager` attempting to SELECT `ecosystem_events` → 0 rows.
- `bd_manager` attempting to SELECT `leadership_reports` → 0 rows.
- `leadership` attempting to UPDATE `companies` → error.
- `leadership` attempting to UPDATE `leadership_reports.executive_summary` → error.
- `leadership` updating `leadership_feedback_text` on `draft` report → error.
- `leadership` updating `leadership_feedback_text` on `finalised` report → success; `_by` and `_at` stamped from server.
- `bd_head` attempting to INSERT into `bnc_uploads` → error.
- `bd_manager` updating another BDM's `companies` row → 0 rows affected.

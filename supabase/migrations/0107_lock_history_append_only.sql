-- 0107_lock_history_append_only.sql
-- Make `level_history` and `audit_events` append-only at the DB level.
-- RLS already blocks client-side deletes (neither table has a DELETE
-- policy — 0022:65-75 for level_history; 0016+0022 for audit_events),
-- but raw SQL access via the Supabase SQL editor, a service-role
-- client, or a superuser psql session bypasses RLS entirely. That is
-- how the 2026-06-26 incident wiped ~95 pre-cutover `level_history`
-- rows: not by any application code path, but by direct SQL that
-- deleted rows with no audit trail (see Section 4 of the data-loss
-- diagnostic dossier).
--
-- Fix: BEFORE DELETE STATEMENT triggers on both tables that RAISE
-- EXCEPTION unconditionally. Any DELETE — bare, WHERE-scoped, or
-- cascaded via a FK — is blocked and the surrounding transaction
-- rolls back. Every INSERT + the existing `UPDATE level_history SET
-- is_credited = ...` flag-flip path stays untouched (the trigger
-- only fires on DELETE).
--
-- Deliberately absolute — repo inspection (Step 0 for this migration)
-- confirmed:
--   - No application code path deletes from level_history / audit_events.
--   - No application code path hard-deletes a companies row (soft-delete
--     via is_active / merged_into_company_id is the only disposal path).
--   - The single cascade route into level_history is
--     `companies.id → level_history.company_id ON DELETE CASCADE`
--     (0005:8). Because companies is never hard-deleted from the app,
--     that cascade never fires in normal operation. When it DOES fire
--     — a raw admin `DELETE FROM companies WHERE …` in the SQL editor
--     — this trigger blocks the cascade, causing the parent delete to
--     roll back too. That is the desired outcome: raw hard-deletes of
--     stakeholders were never supported and would silently wipe the
--     scoring ledger.
--
-- Escape hatch. If a delete is genuinely intended (data migration, GDPR
-- request, one-time cleanup), a table owner disables the specific
-- trigger, runs the delete, and re-enables it — every step visible in
-- the DB. Ordinary service-role / anon / authenticated cannot disable
-- triggers, so this is a deliberate admin action, not a silent bypass:
--
--   ALTER TABLE level_history DISABLE TRIGGER level_history_no_delete;
--   DELETE FROM level_history WHERE ...;
--   ALTER TABLE level_history ENABLE  TRIGGER level_history_no_delete;
--
-- Note on Supabase's project-level unqualified-delete guard. 0090
-- reformulated `rebuild_kpi_actuals` as `DELETE FROM kpi_actuals_daily
-- WHERE true` to satisfy that guard on unqualified deletes to
-- `kpi_actuals_daily`. This trigger is strictly stronger — it blocks
-- BOTH unqualified and qualified deletes to the two ledger tables —
-- so no separate "WHERE true" enforcement is added here. If the
-- project-level guard is ever disabled, this trigger still catches.

-- ---------------------------------------------------------------------------
-- 1) Shared guard function
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION forbid_delete_append_only()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION
        'Deletes on %.% are blocked — this table is append-only. If a delete is genuinely intended, a table owner must ALTER TABLE %I.%I DISABLE TRIGGER %I, perform the delete, and re-enable the trigger.',
        TG_TABLE_SCHEMA, TG_TABLE_NAME,
        TG_TABLE_SCHEMA, TG_TABLE_NAME,
        TG_NAME
        USING ERRCODE = 'insufficient_privilege';
END;
$$;

COMMENT ON FUNCTION forbid_delete_append_only() IS
    'BEFORE DELETE STATEMENT guard for append-only ledger tables. Raises to abort the surrounding statement — including a cascaded delete from a parent FK. Used by 0107 on level_history and audit_events.';

-- ---------------------------------------------------------------------------
-- 2) Trigger on level_history
-- ---------------------------------------------------------------------------

DROP TRIGGER IF EXISTS level_history_no_delete ON level_history;
CREATE TRIGGER level_history_no_delete
    BEFORE DELETE ON level_history
    FOR EACH STATEMENT EXECUTE FUNCTION forbid_delete_append_only();

COMMENT ON TRIGGER level_history_no_delete ON level_history IS
    'Append-only guard (0107). Blocks every DELETE against level_history, including deletes cascaded from a companies row deletion via the ON DELETE CASCADE on level_history.company_id (0005:8). Since companies is never hard-deleted from the app, cascade firings only happen on raw admin SQL — which is exactly what this guard exists to catch (the 2026-06-26 wipe pattern).';

-- ---------------------------------------------------------------------------
-- 3) Trigger on audit_events
-- ---------------------------------------------------------------------------

DROP TRIGGER IF EXISTS audit_events_no_delete ON audit_events;
CREATE TRIGGER audit_events_no_delete
    BEFORE DELETE ON audit_events
    FOR EACH STATEMENT EXECUTE FUNCTION forbid_delete_append_only();

COMMENT ON TRIGGER audit_events_no_delete ON audit_events IS
    'Append-only guard (0107). Blocks every DELETE against audit_events. audit_events has no ON DELETE CASCADE parent so the guard only fires on direct DELETEs (raw SQL sessions) — no cascade path is exposed.';

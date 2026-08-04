-- 0103_notification_type_claim.sql
-- Add 'claim' to notification_type_t so admin + bd_head can be
-- notified whenever a member claims a stakeholder.
--
-- ALONE, on purpose. PostgreSQL's ALTER TYPE ADD VALUE cannot be
-- referenced in the same transaction it's added (same rule as the
-- view-column lesson from 0099). The RPC that actually inserts a
-- 'claim'-typed notification lands in 0104 — one migration later,
-- so it executes in a separate transaction from the enum change.
--
-- Idempotent — safe re-run.

ALTER TYPE notification_type_t ADD VALUE IF NOT EXISTS 'claim';

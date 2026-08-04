-- 0105_notification_type_task_completed.sql
-- Add 'task_completed' to notification_type_t so a lead can close
-- the loop when a task they assigned to a member gets done.
--
-- ALONE, on purpose. PostgreSQL's ALTER TYPE ADD VALUE cannot be
-- referenced in the same transaction it's added — same rule as
-- 0099 / 0103. The RPC that actually inserts a 'task_completed'
-- notification lands in 0106.
--
-- Idempotent — safe re-run.

ALTER TYPE notification_type_t ADD VALUE IF NOT EXISTS 'task_completed';

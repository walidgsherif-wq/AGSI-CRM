-- 0095_realtime_notifications.sql
-- Enable Supabase Realtime on the `notifications` table so the
-- dashboard action queue and the sidebar bell can subscribe to
-- INSERT + UPDATE events and refresh without a manual reload.
--
-- Scope: notifications only. No other table joins realtime.
--
-- Two DDLs, both guarded so re-run is safe:
--
--   1) ALTER PUBLICATION supabase_realtime ADD TABLE notifications
--      — teaches the WAL slot to fan changes on this table out to
--      subscribed clients. The recipient_id = auth.uid() SELECT
--      policy from 0022:308 is enforced by Realtime, so a client
--      only ever sees their own rows.
--
--   2) ALTER TABLE notifications REPLICA IDENTITY FULL
--      — required by Realtime on tables with RLS so UPDATE payloads
--      carry the OLD row (Realtime needs the full row to evaluate
--      the SELECT policy against it). Default REPLICA IDENTITY
--      DEFAULT only ships the PK columns on UPDATE, which fails the
--      policy check and drops the event silently.
--
-- No app-side schema change. No policy change. No RPC.

-- The publication is created by Supabase infra on project bootstrap
-- and always named `supabase_realtime`. If a fresh project doesn't
-- have it yet (rare, but happens on brand-new local stacks), fail
-- loud rather than silently no-op.

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
          FROM pg_publication_tables
         WHERE pubname   = 'supabase_realtime'
           AND schemaname = 'public'
           AND tablename  = 'notifications'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
    END IF;
END $$;

ALTER TABLE public.notifications REPLICA IDENTITY FULL;

COMMENT ON TABLE public.notifications IS
    'Per-user in-app notifications. Realtime is enabled on this table '
    'via supabase_realtime publication (0095) so the dashboard action '
    'queue and sidebar bell live-update on INSERT + UPDATE. The '
    'existing SELECT policy notifications_select_own (recipient_id = '
    'auth.uid()) is what scopes the delivered events per user.';

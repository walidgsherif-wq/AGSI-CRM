-- 0064_invited_users_admin_rls.sql
-- Adds minimal RLS on invited_users so /admin/users can render the
-- pending-invitations block under the signed-in admin's session
-- (the page reads via cookie-auth, not service-role).
--
-- - SELECT for admin only — invited_users contains email + role
--   metadata about people who haven't joined yet; not for general
--   visibility.
-- - DELETE for admin only — backs the "Revoke" action.
-- - No INSERT / UPDATE policies. inviteUser still writes via the
--   service-role admin client (users.ts adminClient), which bypasses
--   RLS regardless.
--
-- claim_invited_profile() in 0063 is SECURITY DEFINER and continues
-- to work regardless of these policies (it runs as the function
-- owner).

DROP POLICY IF EXISTS invited_users_select_admin ON invited_users;
CREATE POLICY invited_users_select_admin
    ON invited_users FOR SELECT
    USING (auth_role() = 'admin');

DROP POLICY IF EXISTS invited_users_delete_admin ON invited_users;
CREATE POLICY invited_users_delete_admin
    ON invited_users FOR DELETE
    USING (auth_role() = 'admin');

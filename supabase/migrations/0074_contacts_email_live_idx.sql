-- 0074_contacts_email_live_idx.sql
-- The inbound-email resolver looks up companies by stakeholder email
-- against contacts.email (live only). Without an index, every webhook
-- request scans the contacts table; benign now but quadratic as the
-- contacts table grows.
--
-- Partial: only LIVE rows participate in the resolver, and only rows
-- with an email value. Archived rows and email-less contacts are
-- excluded from the index entirely.

CREATE INDEX IF NOT EXISTS contacts_email_live_idx
    ON contacts (email)
    WHERE deleted_at IS NULL AND email IS NOT NULL;

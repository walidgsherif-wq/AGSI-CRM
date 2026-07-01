-- 0087_inbound_email_domain_harvest.sql
-- Support domain-scoped counterparty harvesting on inbound-email
-- resolve. Two small additions:
--
--   1) companies.email_domain — the counterparty's mail domain (e.g.
--      "wasl.ae"). Learned on first resolve if not already set. The
--      inbound-email webhook resolver (src/app/api/inbound-email/
--      route.ts) matches each stakeholder email's domain against this
--      column, so once it's learned, future emails from the same
--      domain auto-match instead of landing in the unmatched queue.
--
--   2) contacts.needs_details — a per-contact incomplete flag. Set on
--      auto-harvested rows so they surface as "Needs details" on the
--      company Contacts section. Cleared automatically by the contact
--      edit form on the first manual save. Existing contacts stay at
--      false.
--
-- No RPC changes here — the harvest logic lives in the resolve
-- server action (src/server/actions/inbound-email.ts).

-- ---------------------------------------------------------------------------
-- 1) companies.email_domain
-- ---------------------------------------------------------------------------

ALTER TABLE companies
    ADD COLUMN IF NOT EXISTS email_domain text NULL;

COMMENT ON COLUMN companies.email_domain IS
    'Counterparty mail domain, e.g. "wasl.ae". Auto-learned by the '
    'inbound-email resolve action when a company is first matched from '
    'an email with a consistent external domain. The webhook resolver '
    'matches stakeholder-email domains against this column so future '
    'emails from that domain auto-match instead of queueing.';

-- Partial index — the resolver only cares about rows where the domain
-- is actually set, and lower-casing keeps case-insensitive lookups
-- honest against whatever the SMTP header capitalised.
CREATE INDEX IF NOT EXISTS companies_email_domain_idx
    ON companies (lower(email_domain))
    WHERE email_domain IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2) contacts.needs_details
-- ---------------------------------------------------------------------------

ALTER TABLE contacts
    ADD COLUMN IF NOT EXISTS needs_details boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN contacts.needs_details IS
    'True when the row was auto-created from an inbound email (name '
    'from the display header or the email local-part, no position, no '
    'phone). Surfaces as a "Needs details" marker on the company '
    'Contacts section. The contact edit action clears this flag on '
    'the first manual save.';

-- Small partial index so the "Needs details" filter on the Contacts
-- section stays cheap even as the table grows.
CREATE INDEX IF NOT EXISTS contacts_needs_details_idx
    ON contacts (company_id)
    WHERE needs_details = true AND deleted_at IS NULL;

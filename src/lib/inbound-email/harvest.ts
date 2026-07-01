// Domain-scoped counterparty-contact harvesting for the inbound-email
// resolver. Pure functions here so unit tests can exercise the address
// parsing, domain inference, and dedup selection without a DB.
//
// The resolver server action (src/server/actions/inbound-email.ts)
// composes these with the unmatched row's stored addresses + a
// company snapshot, then inserts the resulting contacts.

const INTERNAL_DOMAIN = 'agsi.ae';

/**
 * Local parts that are almost always distribution / role / catch-all
 * addresses rather than a person. Kept intentionally short and
 * conservative — anything more aggressive risks dropping legitimate
 * contacts like "sales.pmo@…".
 */
const ROLE_LOCAL_PARTS = new Set([
  'info',
  'contact',
  'contacts',
  'mail',
  'admin',
  'sales',
  'enquiries',
  'inquiries',
  'no-reply',
  'noreply',
  'donotreply',
  'do-not-reply',
  'support',
  'help',
  'hello',
  'hi',
  'hr',
  'careers',
  'jobs',
  'marketing',
  'accounts',
  'accounting',
  'billing',
  'finance',
  'legal',
  'compliance',
  'reception',
  'office',
]);

export type HarvestCandidate = {
  /** Bare, lower-cased email. */
  email: string;
  /** Header display name if we have one, else null. */
  display_name: string | null;
};

/**
 * Split an email into [local, domain]. Returns null if malformed.
 * Case is preserved for the display side but the caller lower-cases
 * both parts before comparing.
 */
export function splitEmail(email: string): { local: string; domain: string } | null {
  const at = email.lastIndexOf('@');
  if (at <= 0 || at === email.length - 1) return null;
  const local = email.slice(0, at).trim();
  const domain = email.slice(at + 1).trim();
  if (!local || !domain) return null;
  return { local, domain };
}

/**
 * Extract the mail-domain part of a URL / hostname string. Returns
 * null for empty or unparseable input.
 *   "https://www.wasl.ae/about"  → "wasl.ae"
 *   "wasl.ae"                    → "wasl.ae"
 *   ""                           → null
 */
export function domainFromWebsite(website: string | null | undefined): string | null {
  if (!website) return null;
  const trimmed = website.trim();
  if (!trimmed) return null;
  // Strip protocol if present so URL() doesn't fail on bare hosts.
  const withScheme = /^[a-z]+:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const host = new URL(withScheme).hostname.toLowerCase();
    return host.replace(/^www\./, '') || null;
  } catch {
    // Not URL-shaped; treat whole string as a hostname if it looks like one.
    const bare = trimmed.toLowerCase().replace(/^www\./, '');
    return /\./.test(bare) ? bare : null;
  }
}

/**
 * Is this local-part on our role-address blocklist?
 */
export function isRoleAddress(local: string): boolean {
  return ROLE_LOCAL_PARTS.has(local.toLowerCase());
}

/**
 * Is this an internal @agsi.ae address? (The whole point of this rewrite.)
 */
export function isInternalDomain(domain: string): boolean {
  return domain.trim().toLowerCase() === INTERNAL_DOMAIN;
}

/**
 * From the sender + recipient + CC lists, produce candidate contacts
 * grouped by email. Duplicates within the input collapse; display
 * names are preferred over local-part fallbacks. Any input that
 * doesn't parse as an email is dropped silently.
 */
export function collectCandidates(input: {
  from_email: string | null | undefined;
  from_name: string | null | undefined;
  to_emails: readonly string[];
  cc_emails: readonly string[];
  /** Optional richer parse from raw_payload with display names for
   *  recipient / CC addresses. When present, wins over local-part
   *  fallback for those addresses. */
  headers?: {
    to: readonly { email: string; name: string | null }[];
    cc: readonly { email: string; name: string | null }[];
  };
}): HarvestCandidate[] {
  const byEmail = new Map<string, HarvestCandidate>();

  function push(rawEmail: string | null | undefined, displayName: string | null | undefined) {
    if (!rawEmail) return;
    const email = rawEmail.trim().toLowerCase();
    if (!email) return;
    const parts = splitEmail(email);
    if (!parts) return;
    const existing = byEmail.get(email);
    const display = (displayName ?? '').trim() || null;
    if (existing) {
      if (!existing.display_name && display) existing.display_name = display;
      return;
    }
    byEmail.set(email, { email, display_name: display });
  }

  push(input.from_email, input.from_name ?? null);
  for (const t of input.to_emails) push(t, null);
  for (const c of input.cc_emails) push(c, null);

  // If the raw_payload supplied header rows with display names,
  // upgrade those entries.
  if (input.headers) {
    for (const h of input.headers.to) push(h.email, h.name);
    for (const h of input.headers.cc) push(h.email, h.name);
  }

  return Array.from(byEmail.values());
}

/**
 * Infer the counterparty domain from a set of candidate addresses:
 *   - drop internal (@agsi.ae) addresses
 *   - drop role addresses (they usually match everyone anyway)
 *   - count the remaining domains
 *
 * If a single domain dominates (strict majority OR only one present),
 * return it. If two-or-more external domains tie, return null so the
 * caller can decline to harvest rather than pick wrong.
 */
export function inferCounterpartyDomain(
  candidates: readonly HarvestCandidate[],
): string | null {
  const counts = new Map<string, number>();
  for (const c of candidates) {
    const parts = splitEmail(c.email);
    if (!parts) continue;
    const domain = parts.domain.toLowerCase();
    if (isInternalDomain(domain)) continue;
    if (isRoleAddress(parts.local)) continue;
    counts.set(domain, (counts.get(domain) ?? 0) + 1);
  }
  if (counts.size === 0) return null;
  if (counts.size === 1) return counts.keys().next().value ?? null;
  // Strict majority: one domain > all others summed.
  let top: { domain: string; n: number } | null = null;
  let total = 0;
  for (const [domain, n] of counts) {
    total += n;
    if (!top || n > top.n) top = { domain, n };
  }
  if (!top) return null;
  const rest = total - top.n;
  return top.n > rest ? top.domain : null;
}

/**
 * Filter candidates down to the ones we will actually insert:
 *   - must parse
 *   - must not be @agsi.ae
 *   - must not be a role address
 *   - must be on the counterparty domain (case-insensitive)
 *   - must not already exist on the company as a live contact
 *
 * `existingLiveLowerEmails` is the caller-supplied set of lower-cased
 * emails already attached to the company as live contacts.
 *
 * `full_name` output is the display name if we have one, else the
 * local-part — never blank (contacts.full_name is NOT NULL / not-blank).
 */
export function selectHarvest(
  candidates: readonly HarvestCandidate[],
  counterpartyDomain: string,
  existingLiveLowerEmails: ReadonlySet<string>,
): Array<{ email: string; full_name: string }> {
  const wanted = counterpartyDomain.trim().toLowerCase();
  const out: Array<{ email: string; full_name: string }> = [];
  const seen = new Set<string>();
  for (const c of candidates) {
    const parts = splitEmail(c.email);
    if (!parts) continue;
    const localLower = parts.local.toLowerCase();
    const domainLower = parts.domain.toLowerCase();
    if (isInternalDomain(domainLower)) continue;
    if (isRoleAddress(localLower)) continue;
    if (domainLower !== wanted) continue;
    if (existingLiveLowerEmails.has(c.email)) continue;
    if (seen.has(c.email)) continue;
    seen.add(c.email);
    out.push({
      email: c.email,
      // Never blank — contacts.full_name has a not-blank CHECK.
      full_name: c.display_name?.trim() || parts.local,
    });
  }
  return out;
}

/**
 * Parse the To / CC arrays from raw_payload if the provider preserved
 * display names. Handles the two shapes we've actually seen from
 * SendGrid + Postmark:
 *
 *   { to: [{ email, name }, …], cc: [{ email, name }, …] }
 *   { ToFull: [{ Email, Name }, …], CcFull: [{ Email, Name }, …] }
 *
 * If neither shape matches, returns empty arrays — the caller falls
 * back to the bare to_emails / cc_emails columns.
 */
export function extractHeadersFromRawPayload(
  payload: unknown,
): { to: { email: string; name: string | null }[]; cc: { email: string; name: string | null }[] } {
  if (!payload || typeof payload !== 'object') return { to: [], cc: [] };
  const p = payload as Record<string, unknown>;
  function readArray(entries: unknown): { email: string; name: string | null }[] {
    if (!Array.isArray(entries)) return [];
    const out: { email: string; name: string | null }[] = [];
    for (const e of entries) {
      if (!e || typeof e !== 'object') continue;
      const rec = e as Record<string, unknown>;
      const email =
        (typeof rec.email === 'string' && rec.email) ||
        (typeof rec.Email === 'string' && rec.Email) ||
        '';
      const name =
        (typeof rec.name === 'string' && rec.name) ||
        (typeof rec.Name === 'string' && rec.Name) ||
        null;
      if (email) out.push({ email: String(email), name: name ? String(name) : null });
    }
    return out;
  }
  return {
    to: readArray(p.to ?? p.ToFull),
    cc: readArray(p.cc ?? p.CcFull),
  };
}

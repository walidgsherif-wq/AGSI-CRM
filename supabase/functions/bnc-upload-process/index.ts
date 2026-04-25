// Edge Function: bnc-upload-process
// =====================================================================
// Single-file Deno port of the BNC upload pipeline. Runs inside Supabase's
// network so DB round-trips drop from ~150ms (Vercel→Supabase) to <5ms,
// killing the 60s function timeout problem we hit on Vercel for ~3500-row
// files.
//
// Deploy via Supabase Dashboard → Edge Functions → Create new function
// → name "bnc-upload-process" → paste this entire file → Deploy.
// No CLI required.
//
// The function expects a multipart POST with:
//   file:        the .xlsx (max 50MB)
//   file_date:   YYYY-MM-DD
//   reprocess:   "on" to bypass the duplicate-file_date guard
//
// Auth: caller's session JWT in the Authorization header. The function
// verifies the caller is an active admin profile before doing any work.
// =====================================================================

// @ts-expect-error — Deno-style URL imports are resolved at runtime.
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
// @ts-expect-error — npm: prefix is Supabase Edge Runtime sugar.
import * as XLSX from 'npm:xlsx@0.18.5';

declare const Deno: {
  env: { get(k: string): string | undefined };
  serve(handler: (req: Request) => Promise<Response>): void;
};

// ---------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

// ---------------------------------------------------------------------
// Normalise + tokenise (inlined from src/lib/bnc/{normalise,tokenise}.ts)
// ---------------------------------------------------------------------

const SUFFIXES = [
  'llc', 'l.l.c', 'l.l.c.', 'pjsc', 'p.j.s.c', 'fzc', 'fzco', 'fze',
  'jsc', 'co', 'co.', 'corp', 'corp.', 'inc', 'inc.', 'ltd', 'limited',
  'ltd.', 'group', 'holdings', 'establishment', 'est', 'est.',
];
const SUFFIX_RE = new RegExp(
  '\\s+(?:' + SUFFIXES.map((s) => s.replace(/\./g, '\\.')).join('|') + ')\\s*$',
  'i',
);

function normaliseCompanyName(raw: string): string {
  let s = raw.toLowerCase().normalize('NFKC');
  s = s.replace(/\s+/g, ' ').trim();
  s = s.replace(/^[\s.,;:'"()-]+|[\s.,;:'"()-]+$/g, '');
  let prev: string;
  do {
    prev = s;
    s = s.replace(SUFFIX_RE, '').trim();
  } while (s !== prev && s.length > 0);
  return s;
}

function tidyCompanyName(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim();
}

const SKIP_VALUES = new Set([
  '', '-', '—', 'n/a', 'na', 'none', 'tba', 'tbd',
  'not yet awarded', 'not awarded', 'not appointed',
  'not yet appointed', 'unknown',
]);

function shouldSkip(s: string): boolean {
  return SKIP_VALUES.has(s.toLowerCase().trim());
}

function splitTopLevel(cell: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let buf = '';
  for (const ch of cell) {
    if (ch === '(' || ch === '[' || ch === '{') depth++;
    else if (ch === ')' || ch === ']' || ch === '}') depth = Math.max(0, depth - 1);
    if (ch === ',' && depth === 0) {
      if (buf.trim()) out.push(buf.trim());
      buf = '';
    } else {
      buf += ch;
    }
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

function extractAliases(token: string): { name: string; aliases: string[] } {
  const aliases: string[] = [];
  const cleaned = token.replace(/\(([^()]*)\)/g, (_m: string, inner: string) => {
    const trimmed = inner.trim();
    if (trimmed) aliases.push(trimmed);
    return ' ';
  });
  return {
    name: tidyCompanyName(cleaned),
    aliases: aliases.map((a) => tidyCompanyName(a)).filter((a) => a.length > 0),
  };
}

type CompanyToken = { name: string; aliases: string[]; raw: string };

function tokeniseCompanyCell(cell: string | null | undefined): CompanyToken[] {
  if (!cell) return [];
  const tokens = splitTopLevel(cell)
    .map((t) => t.trim())
    .filter((t) => !shouldSkip(t));
  const out: CompanyToken[] = [];
  const seen = new Set<string>();
  for (const raw of tokens) {
    const { name, aliases } = extractAliases(raw);
    if (!name || shouldSkip(name)) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name, aliases, raw });
  }
  return out;
}

function nthOrNull(cell: string | null | undefined, i: number): string | null {
  if (!cell) return null;
  const parts = splitTopLevel(cell).map((s) => s.trim());
  const v = parts[i];
  if (v === undefined) return null;
  if (shouldSkip(v)) return null;
  return v;
}

// ---------------------------------------------------------------------
// Stage map
// ---------------------------------------------------------------------

type ProjectStage =
  | 'concept' | 'design' | 'tender' | 'tender_submission' | 'tender_evaluation'
  | 'under_construction' | 'completed' | 'on_hold' | 'cancelled';

const STAGE_RULES: Array<{ match: RegExp; stage: ProjectStage }> = [
  { match: /\bunder\s*construction\b/i, stage: 'under_construction' },
  { match: /\bcompleted?\b/i, stage: 'completed' },
  { match: /\bon\s*hold\b/i, stage: 'on_hold' },
  { match: /\bcancell?ed\b/i, stage: 'cancelled' },
  { match: /\btender\s*evaluation\b/i, stage: 'tender_evaluation' },
  { match: /\btender\s*submission\b|\bbidding\b/i, stage: 'tender_submission' },
  { match: /\btender\b/i, stage: 'tender' },
  { match: /\b(detailed|schematic)?\s*design\b/i, stage: 'design' },
  { match: /\bconcept(ual)?\b/i, stage: 'concept' },
];

function mapStage(raw: string | null | undefined): {
  stage: ProjectStage; warning: string | null;
} {
  const value = (raw ?? '').trim();
  if (!value) return { stage: 'concept', warning: 'empty' };
  for (const r of STAGE_RULES) {
    if (r.match.test(value)) return { stage: r.stage, warning: null };
  }
  return { stage: 'concept', warning: `unknown:${value}` };
}

// ---------------------------------------------------------------------
// XLSX parser (auto-detects header row)
// ---------------------------------------------------------------------

type RawRow = Record<string, string | null>;
type ParseResult = { headers: string[]; rows: RawRow[]; headerRowIndex: number };

const HEADER_HINTS = ['reference number', 'project name', 'reference no', 'project ref'];

function looksLikeHeader(row: unknown[]): boolean {
  const lc = row
    .map((v) => (typeof v === 'string' ? v.toLowerCase().trim() : ''))
    .filter(Boolean);
  return HEADER_HINTS.some((hint) => lc.some((cell) => cell.includes(hint)));
}

function cellToString(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'number') return String(v);
  return String(v).trim();
}

function parseBncWorkbook(buffer: ArrayBuffer): ParseResult {
  const wb = XLSX.read(buffer, { type: 'array', cellDates: true });
  const firstSheetName = wb.SheetNames[0];
  if (!firstSheetName) throw new Error('Workbook has no sheets.');
  const sheet = wb.Sheets[firstSheetName];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1, raw: true, blankrows: false, defval: null,
  });

  let headerRowIndex = -1;
  for (let i = 0; i < Math.min(10, rows.length); i++) {
    if (looksLikeHeader(rows[i] ?? [])) {
      headerRowIndex = i;
      break;
    }
  }
  if (headerRowIndex < 0) {
    throw new Error(
      'Could not locate header row. Expected "Reference Number" or "Project Name" within first 10 rows.',
    );
  }

  const headerRaw = rows[headerRowIndex] ?? [];
  const headers = headerRaw.map((h: unknown) =>
    typeof h === 'string' ? h.trim() : String(h ?? '').trim(),
  );

  const dataRows: RawRow[] = [];
  for (let r = headerRowIndex + 1; r < rows.length; r++) {
    const row = rows[r] ?? [];
    if (row.every((v: unknown) => v === null || v === '')) continue;
    const obj: RawRow = {};
    for (let c = 0; c < headers.length; c++) {
      const key = headers[c];
      if (!key) continue;
      obj[key] = cellToString(row[c]);
    }
    dataRows.push(obj);
  }

  return { headers, rows: dataRows, headerRowIndex };
}

function pickColumn(row: RawRow, aliases: string[]): string | null {
  for (const a of aliases) {
    if (a in row && row[a] !== null && row[a] !== '') return row[a];
    const found = Object.keys(row).find((k) => k.toLowerCase() === a.toLowerCase());
    if (found && row[found] !== null && row[found] !== '') return row[found];
  }
  return null;
}

function parseNumber(s: string | null): number | null {
  if (s === null || s === undefined) return null;
  const t = String(s).trim();
  if (!t || t.toUpperCase() === 'N/A' || t === '-') return null;
  const cleaned = t.replace(/,/g, '');
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function parseDate(s: string | null): string | null {
  if (!s) return null;
  const t = String(s).trim();
  if (!t || t.toUpperCase() === 'N/A') return null;
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = t.match(/^(\d{4})-(\d{2})-(\d{2})T/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) {
    const dd = m[1].padStart(2, '0');
    const mm = m[2].padStart(2, '0');
    let yyyy = m[3];
    if (yyyy.length === 2) {
      const n = parseInt(yyyy, 10);
      yyyy = (n < 50 ? 2000 + n : 1900 + n).toString();
    }
    return `${yyyy}-${mm}-${dd}`;
  }
  return null;
}

// ---------------------------------------------------------------------
// Processor (Stages B-D)
// ---------------------------------------------------------------------

type CompanyType =
  | 'developer' | 'design_consultant' | 'main_contractor'
  | 'mep_consultant' | 'mep_contractor' | 'authority' | 'other';

type CompanyRoleColumn =
  | 'owner' | 'design_consultant' | 'main_contractor'
  | 'mep_consultant' | 'mep_contractor';

const ROLE_COLUMNS: Array<{
  role: CompanyRoleColumn;
  companyType: CompanyType;
  nameAliases: string[];
  phoneAliases: string[];
  contactAliases: string[];
  emailAliases: string[];
}> = [
  {
    role: 'owner', companyType: 'developer',
    nameAliases: ['Owners', 'Owner'],
    phoneAliases: ['Owners Phone'],
    contactAliases: ['Owners Key Contact'],
    emailAliases: ['Owners Email'],
  },
  {
    role: 'design_consultant', companyType: 'design_consultant',
    nameAliases: ['Lead/Infra/FEED/Design Consultants', 'Design Consultants', 'Lead Consultant'],
    phoneAliases: ['Lead/Infra/FEED/Design Consultants Phone', 'Design Consultants Phone'],
    contactAliases: ['Lead/Infra/FEED/Design Consultants Key Contact', 'Design Consultants Key Contact'],
    emailAliases: ['Lead/Infra/FEED/Design Consultants Email', 'Design Consultants Email'],
  },
  {
    role: 'main_contractor', companyType: 'main_contractor',
    nameAliases: ['Main/Infra/EPC Contractors', 'Main Contractors', 'EPC Contractor'],
    phoneAliases: ['Main/Infra/EPC Contractors Phone', 'Main Contractors Phone'],
    contactAliases: ['Main/Infra/EPC Contractors Key Contact', 'Main Contractors Key Contact'],
    emailAliases: ['Main/Infra/EPC Contractors Email', 'Main Contractors Email'],
  },
  {
    role: 'mep_consultant', companyType: 'mep_consultant',
    nameAliases: ['MEP Consultants'],
    phoneAliases: ['MEP Consultants Phone'],
    contactAliases: ['MEP Consultants Key Contact'],
    emailAliases: ['MEP Consultants Email'],
  },
  {
    role: 'mep_contractor', companyType: 'mep_contractor',
    nameAliases: ['MEP Contractors'],
    phoneAliases: ['MEP Contractors Phone'],
    contactAliases: ['MEP Contractors Key Contact'],
    emailAliases: ['MEP Contractors Email'],
  },
];

type ProcessSummary = {
  rowsTotal: number; rowsProcessed: number; rowsErrored: number;
  newProjects: number; updatedProjects: number; dormantProjects: number;
  newCompanies: number; matchedCompanies: number; unmatchedCompanies: number;
  warnings: string[];
};

async function processBncRows(
  supabase: SupabaseClient,
  uploadId: string,
  fileDate: string | null,
  rows: RawRow[],
): Promise<ProcessSummary> {
  const startedAt = Date.now();
  const summary: ProcessSummary = {
    rowsTotal: rows.length, rowsProcessed: 0, rowsErrored: 0,
    newProjects: 0, updatedProjects: 0, dormantProjects: 0,
    newCompanies: 0, matchedCompanies: 0, unmatchedCompanies: 0,
    warnings: [],
  };
  const nowIso = new Date().toISOString();
  const lastSeenAt = fileDate ? new Date(fileDate).toISOString() : nowIso;

  // Phase 1: pre-fetch existing projects + companies into hashmaps
  const phase1Started = Date.now();
  const projectsByRef = new Map<string, { id: string; ref: string | null }>();
  const projectsByName = new Map<string, { id: string; ref: string | null }>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from('projects').select('id, bnc_reference_number, name')
      .range(from, from + 999);
    if (error) throw error;
    if (!data || data.length === 0) break;
    for (const r of data as Array<{ id: string; bnc_reference_number: string | null; name: string }>) {
      const idx = { id: r.id, ref: r.bnc_reference_number };
      if (r.bnc_reference_number) projectsByRef.set(r.bnc_reference_number, idx);
      projectsByName.set(r.name.toLowerCase(), idx);
    }
    if (data.length < 1000) break;
  }

  const companiesByLowerName = new Map<string, { id: string; aliases: string[] }>();
  const companiesByAlias = new Map<string, { id: string; aliases: string[] }>();
  const allCompanies = new Map<string, { id: string; aliases: string[] }>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from('companies').select('id, canonical_name, aliases')
      .range(from, from + 999);
    if (error) throw error;
    if (!data || data.length === 0) break;
    for (const r of data as Array<{ id: string; canonical_name: string; aliases: string[] | null }>) {
      const idx = { id: r.id, aliases: r.aliases ?? [] };
      companiesByLowerName.set(r.canonical_name.toLowerCase(), idx);
      allCompanies.set(r.id, idx);
      for (const a of idx.aliases) companiesByAlias.set(a.toLowerCase(), idx);
    }
    if (data.length < 1000) break;
  }
  summary.warnings.push(
    `phase1 prefetch ${projectsByRef.size}+${projectsByName.size}p / ${allCompanies.size}c in ${((Date.now() - phase1Started) / 1000).toFixed(1)}s`,
  );

  // Phase 2: collect resolver contexts + unique tokens needing fuzzy lookup
  const phase2Started = Date.now();
  type ResolveContext = {
    rowIndex: number; role: CompanyRoleColumn; inferredType: CompanyType;
    contact: { phone: string | null; contact: string | null; email: string | null };
    token: CompanyToken;
  };
  const resolvers: ResolveContext[] = [];
  const fuzzyKeys = new Set<string>();

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    for (const def of ROLE_COLUMNS) {
      const cell = pickColumn(row, def.nameAliases);
      const tokens = tokeniseCompanyCell(cell);
      const phoneCell = pickColumn(row, def.phoneAliases);
      const contactCell = pickColumn(row, def.contactAliases);
      const emailCell = pickColumn(row, def.emailAliases);
      for (let t = 0; t < tokens.length; t++) {
        const token = tokens[t];
        resolvers.push({
          rowIndex: i, role: def.role, inferredType: def.companyType,
          contact: {
            phone: nthOrNull(phoneCell, t),
            contact: nthOrNull(contactCell, t),
            email: nthOrNull(emailCell, t),
          },
          token,
        });
        const lower = token.name.toLowerCase();
        if (!companiesByLowerName.has(lower) && !companiesByAlias.has(lower)) {
          fuzzyKeys.add(token.name);
        }
      }
    }
  }
  summary.warnings.push(
    `phase2 collect ${resolvers.length} tokens (${fuzzyKeys.size} need fuzzy) in ${((Date.now() - phase2Started) / 1000).toFixed(1)}s`,
  );

  // Phase 3: fuzzy lookups in parallel batches.
  // Short-circuit when the existing-companies index is small: every fuzzy
  // result would be null anyway, so wasting tens of seconds on RPCs that
  // can't match against anything is the #1 reason first uploads time out.
  const fuzzyResults = new Map<string, { company_id: string; similarity_score: number } | null>();
  const phase3Started = Date.now();
  if (allCompanies.size < 100) {
    summary.warnings.push(
      `phase3 skipped fuzzy (existing companies=${allCompanies.size}, fuzzyKeys=${fuzzyKeys.size})`,
    );
  } else {
    const fuzzyTokens = Array.from(fuzzyKeys);
    for (let i = 0; i < fuzzyTokens.length; i += 200) {
      const slice = fuzzyTokens.slice(i, i + 200);
      await Promise.all(slice.map(async (raw) => {
        const norm = normaliseCompanyName(raw);
        if (!norm) { fuzzyResults.set(raw, null); return; }
        const { data } = await supabase.rpc('find_company_by_fuzzy_name', {
          p_token: norm, p_threshold: 0.75,
        });
        const best = Array.isArray(data) && data.length > 0
          ? (data[0] as { company_id: string; similarity_score: number })
          : null;
        fuzzyResults.set(raw, best);
      }));
    }
    summary.warnings.push(
      `phase3 fuzzy ${fuzzyKeys.size} tokens in ${((Date.now() - phase3Started) / 1000).toFixed(1)}s`,
    );
  }

  // Phase 4: in-memory accumulation
  type ProjectFields = Record<string, unknown> & { id: string };
  type CompanyInsert = Record<string, unknown> & { id: string };
  type ProjectCompanyLink = {
    project_id: string; company_id: string; role: CompanyRoleColumn;
    raw_name_from_bnc: string; last_seen_in_upload_id: string;
    last_seen_in_upload_at: string; is_current: true;
  };

  const projectsToInsert: ProjectFields[] = [];
  const projectsToUpdate: ProjectFields[] = [];
  const companiesToInsert: CompanyInsert[] = [];
  const companyAliasMerges = new Map<string, Set<string>>();
  const projectCompanyLinks = new Map<string, ProjectCompanyLink>();
  const matchQueueEntries: Array<{
    upload_id: string; raw_name: string; suggested_company_id: string | null;
    similarity_score: number | null; status: 'pending';
  }> = [];
  const newCompaniesByLowerName = new Map<string, string>();
  const projectIdByRowIndex = new Map<number, string>();
  const phase4Started = Date.now();

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const ref = pickColumn(row, ['Reference Number', 'Reference No', 'PRJ Reference']);
    const name = pickColumn(row, ['Project Name', 'Name']);
    if (!name) {
      summary.warnings.push(`row ${i}: missing Project Name`);
      continue;
    }
    const stageRaw = pickColumn(row, ['Stage']);
    const { stage, warning } = mapStage(stageRaw);
    if (warning && summary.warnings.length < 50) summary.warnings.push(`row ${i} stage: ${warning}`);

    const existingByRef = ref ? projectsByRef.get(ref) : null;
    const existingByName = !existingByRef ? projectsByName.get(name.toLowerCase()) : null;
    const existing = existingByRef ?? existingByName ?? null;
    const id = existing?.id ?? crypto.randomUUID();
    if (!existing) projectsByRef.set(ref ?? `__name__${name.toLowerCase()}`, { id, ref });
    projectIdByRowIndex.set(i, id);

    const fields: ProjectFields = {
      id, name, stage,
      project_type: pickColumn(row, ['Project Type']),
      value_aed: parseNumber(pickColumn(row, ['Value AED', 'Value (AED)'])),
      value_usd: parseNumber(pickColumn(row, ['Value(USD)', 'Value (USD)', 'Value USD'])),
      city: pickColumn(row, ['City']),
      location: pickColumn(row, ['Location']),
      sector: pickColumn(row, ['Sector']),
      industry: pickColumn(row, ['Industry']),
      estimated_completion_date: parseDate(pickColumn(row, ['Estimated Completion Date'])),
      completion_percentage: parseNumber(pickColumn(row, ['Completion Percentage'])),
      bnc_reference_number: ref,
      est_main_contractor_award_date: parseDate(
        pickColumn(row, ['Est. Main/Infra/EPC Contractor Award Date', 'Est. Main Contractor Award Date']),
      ),
      main_contractor_award_value: parseNumber(
        pickColumn(row, ['Main/Infra/EPC Contractor Award Value', 'Main Contractor Award Value']),
      ),
      last_seen_in_upload_id: uploadId,
      last_seen_in_upload_at: lastSeenAt,
      is_dormant: false,
      stage_last_updated_at: nowIso,
    };

    if (existing) {
      projectsToUpdate.push(fields);
      summary.updatedProjects++;
    } else {
      projectsToInsert.push(fields);
      summary.newProjects++;
    }
  }

  for (const ctx of resolvers) {
    const projectId = projectIdByRowIndex.get(ctx.rowIndex);
    if (!projectId) continue;
    const lower = ctx.token.name.toLowerCase();

    let companyId: string | null = companiesByLowerName.get(lower)?.id ?? null;
    let matchKind: 'exact' | 'alias' | 'fuzzy_high' | 'fuzzy_mid' | 'new' | null = null;
    if (companyId) matchKind = 'exact';

    if (!companyId) {
      const aliasHit = companiesByAlias.get(lower);
      if (aliasHit) { companyId = aliasHit.id; matchKind = 'alias'; }
    }
    if (!companyId) {
      const fuzzy = fuzzyResults.get(ctx.token.name);
      if (fuzzy && fuzzy.similarity_score >= 0.85) {
        companyId = fuzzy.company_id; matchKind = 'fuzzy_high';
      } else if (fuzzy && fuzzy.similarity_score >= 0.75) {
        matchQueueEntries.push({
          upload_id: uploadId, raw_name: ctx.token.name,
          suggested_company_id: fuzzy.company_id,
          similarity_score: fuzzy.similarity_score, status: 'pending',
        });
        matchKind = 'fuzzy_mid';
        summary.unmatchedCompanies++;
      }
    }
    if (!companyId && matchKind !== 'fuzzy_mid') {
      const existingNew = newCompaniesByLowerName.get(lower);
      if (existingNew) {
        companyId = existingNew;
        if (ctx.token.aliases.length > 0) {
          const set = companyAliasMerges.get(existingNew) ?? new Set<string>();
          for (const a of ctx.token.aliases) set.add(a);
          companyAliasMerges.set(existingNew, set);
        }
        matchKind = 'new';
      }
    }
    if (!companyId && matchKind !== 'fuzzy_mid') {
      const id = crypto.randomUUID();
      companyId = id;
      newCompaniesByLowerName.set(lower, id);
      companiesToInsert.push({
        id, canonical_name: tidyCompanyName(ctx.token.name),
        company_type: ctx.inferredType, aliases: ctx.token.aliases,
        source: 'bnc_upload', current_level: 'L0',
        last_seen_in_upload_id: uploadId,
        last_seen_in_upload_at: lastSeenAt,
        key_contact_name: ctx.contact.contact,
        key_contact_phone: ctx.contact.phone,
        key_contact_email: ctx.contact.email,
      });
      matchKind = 'new';
      summary.newCompanies++;
    }
    if (matchKind === 'exact' || matchKind === 'alias' || matchKind === 'fuzzy_high') {
      summary.matchedCompanies++;
      if (companyId && ctx.token.aliases.length > 0) {
        const company = allCompanies.get(companyId);
        if (company) {
          const set = companyAliasMerges.get(companyId) ?? new Set(company.aliases);
          for (const a of ctx.token.aliases) set.add(a);
          companyAliasMerges.set(companyId, set);
        }
      }
    }
    if (companyId) {
      projectCompanyLinks.set(`${projectId}|${companyId}|${ctx.role}`, {
        project_id: projectId, company_id: companyId, role: ctx.role,
        raw_name_from_bnc: ctx.token.raw,
        last_seen_in_upload_id: uploadId,
        last_seen_in_upload_at: lastSeenAt,
        is_current: true,
      });
    }
  }
  summary.rowsProcessed = projectIdByRowIndex.size;
  summary.warnings.push(
    `phase4 accumulate (P:${projectsToInsert.length}new+${projectsToUpdate.length}upd, C:${companiesToInsert.length}new, L:${projectCompanyLinks.size}, Q:${matchQueueEntries.length}) in ${((Date.now() - phase4Started) / 1000).toFixed(1)}s`,
  );

  // Phase 5: bulk flush
  const phase5Started = Date.now();
  // Skip bnc_upload_rows insert (large jsonb writes) — keep file in storage as audit trail
  if (projectsToInsert.length > 0) {
    for (let i = 0; i < projectsToInsert.length; i += 1000) {
      const slice = projectsToInsert.slice(i, i + 1000);
      const { error } = await supabase.from('projects').insert(slice);
      if (error) summary.warnings.push(`insert projects: ${error.message}`);
    }
  }
  if (projectsToUpdate.length > 0) {
    for (let i = 0; i < projectsToUpdate.length; i += 1000) {
      const slice = projectsToUpdate.slice(i, i + 1000);
      const { error } = await supabase.from('projects').upsert(slice, { onConflict: 'id' });
      if (error) summary.warnings.push(`update projects: ${error.message}`);
    }
  }
  if (companiesToInsert.length > 0) {
    for (let i = 0; i < companiesToInsert.length; i += 1000) {
      const slice = companiesToInsert.slice(i, i + 1000);
      const { error } = await supabase.from('companies').insert(slice);
      if (error) summary.warnings.push(`insert companies: ${error.message}`);
    }
  }
  if (companyAliasMerges.size > 0) {
    for (const [id, set] of companyAliasMerges) {
      const { error } = await supabase.from('companies')
        .update({ aliases: Array.from(set) }).eq('id', id);
      if (error) summary.warnings.push(`alias merge ${id}: ${error.message}`);
    }
  }
  if (projectCompanyLinks.size > 0) {
    const links = Array.from(projectCompanyLinks.values());
    for (let i = 0; i < links.length; i += 1000) {
      const slice = links.slice(i, i + 1000);
      const { error } = await supabase.from('project_companies')
        .upsert(slice, { onConflict: 'project_id,company_id,role' });
      if (error) summary.warnings.push(`upsert project_companies: ${error.message}`);
    }
  }
  if (matchQueueEntries.length > 0) {
    for (let i = 0; i < matchQueueEntries.length; i += 1000) {
      const slice = matchQueueEntries.slice(i, i + 1000);
      const { error } = await supabase.from('company_match_queue').insert(slice);
      if (error) summary.warnings.push(`insert match queue: ${error.message}`);
    }
  }

  const seenCompanyIds = new Set<string>();
  for (const link of projectCompanyLinks.values()) seenCompanyIds.add(link.company_id);
  if (seenCompanyIds.size > 0) {
    const ids = Array.from(seenCompanyIds);
    for (let i = 0; i < ids.length; i += 1000) {
      const slice = ids.slice(i, i + 1000);
      const { error } = await supabase.from('companies')
        .update({ has_active_projects: true }).in('id', slice);
      if (error) summary.warnings.push(`update has_active_projects: ${error.message}`);
    }
  }
  summary.warnings.push(`phase5 flush in ${((Date.now() - phase5Started) / 1000).toFixed(1)}s`);

  summary.warnings.unshift(`processed in ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
  return summary;
}

// ---------------------------------------------------------------------
// Request handler
// ---------------------------------------------------------------------

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'method not allowed' }, 405);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !anonKey || !serviceKey) {
    return jsonResponse({ error: 'edge function env missing' }, 500);
  }

  // Validate caller is an active admin
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return jsonResponse({ error: 'missing authorization header' }, 401);

  const userClient: SupabaseClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return jsonResponse({ error: 'unauthenticated' }, 401);

  const { data: profile } = await userClient
    .from('profiles')
    .select('role, is_active')
    .eq('id', user.id)
    .single();
  if (!profile || profile.role !== 'admin' || !profile.is_active) {
    return jsonResponse({ error: 'forbidden' }, 403);
  }

  // Parse multipart
  let form: FormData;
  try {
    form = await req.formData();
  } catch (err) {
    return jsonResponse({ error: `Could not parse form data: ${(err as Error).message}` }, 400);
  }
  const file = form.get('file');
  const fileDateRaw = String(form.get('file_date') ?? '');
  const reprocess = form.get('reprocess') === 'on';

  if (!(file instanceof File)) return jsonResponse({ error: 'No file provided.' }, 400);
  if (!file.name.toLowerCase().endsWith('.xlsx')) {
    return jsonResponse({ error: 'File must be .xlsx' }, 400);
  }
  if (file.size > 50 * 1024 * 1024) {
    return jsonResponse({ error: 'File exceeds 50MB.' }, 400);
  }
  const fileDate = parseDate(fileDateRaw);
  if (!fileDate) {
    return jsonResponse(
      { error: 'file_date is required (YYYY-MM-DD or DD/MM/YYYY).' }, 400,
    );
  }

  const admin: SupabaseClient = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  });

  // Duplicate-file_date guard
  if (!reprocess) {
    const { data: dupes } = await admin
      .from('bnc_uploads').select('id, status')
      .eq('file_date', fileDate).limit(1);
    if (dupes && dupes.length > 0) {
      return jsonResponse(
        {
          error: `An upload for ${fileDate} already exists (id ${dupes[0].id}, status ${dupes[0].status}). Tick "reprocess intentional" to upload again.`,
          duplicate_of: dupes[0].id,
        }, 409,
      );
    }
  }

  // Persist to Storage
  const stamp = Date.now();
  const storagePath = `${fileDate}/${stamp}-${file.name}`;
  const arrayBuffer = await file.arrayBuffer();
  const { error: storeErr } = await admin.storage
    .from('bnc-uploads').upload(storagePath, arrayBuffer, {
      contentType: file.type ||
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      upsert: false,
    });
  if (storeErr) {
    return jsonResponse({ error: `Storage upload failed: ${storeErr.message}` }, 500);
  }

  // Insert bnc_uploads row
  const { data: uploadRow, error: insertErr } = await admin.from('bnc_uploads')
    .insert({
      filename: file.name, storage_path: storagePath,
      uploaded_by: user.id, file_date: fileDate, status: 'processing',
    })
    .select('id').single();
  if (insertErr || !uploadRow) {
    return jsonResponse(
      { error: insertErr?.message ?? 'Failed to record upload.' }, 500,
    );
  }
  const uploadId = (uploadRow as { id: string }).id;

  // Parse + process
  try {
    const { rows } = parseBncWorkbook(arrayBuffer);
    const summary = await processBncRows(admin, uploadId, fileDate, rows);

    await admin.from('bnc_uploads').update({
      status: 'completed',
      row_count: summary.rowsTotal,
      new_projects: summary.newProjects,
      updated_projects: summary.updatedProjects,
      dormant_projects: summary.dormantProjects,
      new_companies: summary.newCompanies,
      matched_companies: summary.matchedCompanies,
      unmatched_companies: summary.unmatchedCompanies,
      error_log: summary.warnings.length > 0
        ? summary.warnings.slice(0, 50).join('\n') : null,
    }).eq('id', uploadId);

    // In-app notification to all admins
    const { data: admins } = await admin
      .from('profiles').select('id').eq('role', 'admin');
    if (admins && (admins as Array<{ id: string }>).length > 0) {
      await admin.from('notifications').insert(
        (admins as Array<{ id: string }>).map((a) => ({
          recipient_id: a.id,
          notification_type: 'upload_complete',
          subject: `BNC upload completed (${file.name})`,
          body: `${summary.newProjects} new / ${summary.updatedProjects} updated projects, ${summary.unmatchedCompanies} unmatched companies pending review.`,
          link_url: `/admin/uploads/${uploadId}`,
        })),
      );
    }

    return jsonResponse({ ok: true, upload_id: uploadId, summary });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await admin.from('bnc_uploads')
      .update({ status: 'failed', error_log: msg })
      .eq('id', uploadId);
    return jsonResponse({ error: msg, upload_id: uploadId }, 500);
  }
});

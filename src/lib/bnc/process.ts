// BNC pipeline orchestrator. Batched / in-memory implementation.
//
// Strategy: pre-fetch existing projects + companies into hashmaps, walk all
// rows in-memory accumulating inserts/updates, flush in bulk at the end.
// Replaces the previous per-row sequential-await design which timed out
// on Vercel's 60s function ceiling for files >~20 rows.
//
// Bulk shape:
//   1 SELECT projects (id, bnc_reference_number, name)
//   1 SELECT companies (id, canonical_name, aliases)
//   N RPC find_company_by_fuzzy_name (only for tokens with no exact match,
//     deduped → typically 5-10% of rows × 5 columns)
//   1 INSERT bnc_upload_rows (chunked by 200)
//   1 INSERT projects (new)
//   1 UPDATE projects (per-row updates batched as upsert with conflict-target)
//   1 INSERT companies (new)
//   1 UPDATE companies (alias merges)
//   1 UPSERT project_companies
//   1 INSERT company_match_queue
//   1 UPDATE companies SET has_active_projects = true
//
// For 500 rows × 38 cols × 5 role-tokens ≈ 200 unique tokens → ~200 fuzzy
// RPCs in parallel batches of 25 + ~10 bulk DB ops = comfortably <30s.

import type { SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';
import type { RawRow } from './parse';
import { pickColumn, parseNumber, parseDate } from './parse';
import { tokeniseCompanyCell, nthOrNull, type CompanyToken } from './tokenise';
import { mapStage } from './stage-map';
import { normaliseCompanyName, tidyCompanyName } from './normalise';
import type { CompanyType } from '@/types/domain';

type CompanyRoleColumn =
  | 'owner'
  | 'design_consultant'
  | 'main_contractor'
  | 'mep_consultant'
  | 'mep_contractor';

type RoleColumnDef = {
  role: CompanyRoleColumn;
  companyType: CompanyType;
  nameAliases: string[];
  phoneAliases: string[];
  contactAliases: string[];
  emailAliases: string[];
};

const ROLE_COLUMNS: RoleColumnDef[] = [
  {
    role: 'owner',
    companyType: 'developer',
    nameAliases: ['Owners', 'Owner'],
    phoneAliases: ['Owners Phone'],
    contactAliases: ['Owners Key Contact'],
    emailAliases: ['Owners Email'],
  },
  {
    role: 'design_consultant',
    companyType: 'design_consultant',
    nameAliases: [
      'Lead/Infra/FEED/Design Consultants',
      'Design Consultants',
      'Lead Consultant',
    ],
    phoneAliases: [
      'Lead/Infra/FEED/Design Consultants Phone',
      'Design Consultants Phone',
    ],
    contactAliases: [
      'Lead/Infra/FEED/Design Consultants Key Contact',
      'Design Consultants Key Contact',
    ],
    emailAliases: [
      'Lead/Infra/FEED/Design Consultants Email',
      'Design Consultants Email',
    ],
  },
  {
    role: 'main_contractor',
    companyType: 'main_contractor',
    nameAliases: ['Main/Infra/EPC Contractors', 'Main Contractors', 'EPC Contractor'],
    phoneAliases: ['Main/Infra/EPC Contractors Phone', 'Main Contractors Phone'],
    contactAliases: [
      'Main/Infra/EPC Contractors Key Contact',
      'Main Contractors Key Contact',
    ],
    emailAliases: ['Main/Infra/EPC Contractors Email', 'Main Contractors Email'],
  },
  {
    role: 'mep_consultant',
    companyType: 'mep_consultant',
    nameAliases: ['MEP Consultants'],
    phoneAliases: ['MEP Consultants Phone'],
    contactAliases: ['MEP Consultants Key Contact'],
    emailAliases: ['MEP Consultants Email'],
  },
  {
    role: 'mep_contractor',
    companyType: 'mep_contractor',
    nameAliases: ['MEP Contractors'],
    phoneAliases: ['MEP Contractors Phone'],
    contactAliases: ['MEP Contractors Key Contact'],
    emailAliases: ['MEP Contractors Email'],
  },
];

export type ProcessSummary = {
  rowsTotal: number;
  rowsProcessed: number;
  rowsErrored: number;
  newProjects: number;
  updatedProjects: number;
  dormantProjects: number;
  newCompanies: number;
  matchedCompanies: number;
  unmatchedCompanies: number;
  warnings: string[];
};

type ProjectIndex = { id: string; ref: string | null };
type CompanyIndex = { id: string; canonical: string; aliases: string[] };

type ProjectFields = {
  id: string;
  name: string;
  stage: string;
  project_type: string | null;
  value_aed: number | null;
  value_usd: number | null;
  city: string | null;
  location: string | null;
  sector: string | null;
  industry: string | null;
  estimated_completion_date: string | null;
  completion_percentage: number | null;
  bnc_reference_number: string | null;
  est_main_contractor_award_date: string | null;
  main_contractor_award_value: number | null;
  last_seen_in_upload_id: string;
  last_seen_in_upload_at: string;
  is_dormant: boolean;
  stage_last_updated_at: string;
};

type CompanyInsert = {
  id: string;
  canonical_name: string;
  company_type: CompanyType;
  aliases: string[];
  source: 'bnc_upload';
  current_level: 'L0';
  last_seen_in_upload_id: string;
  last_seen_in_upload_at: string;
  key_contact_name: string | null;
  key_contact_phone: string | null;
  key_contact_email: string | null;
};

type CompanyAliasUpdate = { id: string; aliases: string[] };

type ProjectCompanyLink = {
  project_id: string;
  company_id: string;
  role: CompanyRoleColumn;
  raw_name_from_bnc: string;
  last_seen_in_upload_id: string;
  last_seen_in_upload_at: string;
  is_current: true;
};

type MatchQueueEntry = {
  upload_id: string;
  raw_name: string;
  suggested_company_id: string | null;
  similarity_score: number | null;
  status: 'pending';
};

export async function processBncRows(
  supabase: SupabaseClient,
  uploadId: string,
  fileDate: string | null,
  rows: RawRow[],
): Promise<ProcessSummary> {
  const startedAt = Date.now();
  const summary: ProcessSummary = {
    rowsTotal: rows.length,
    rowsProcessed: 0,
    rowsErrored: 0,
    newProjects: 0,
    updatedProjects: 0,
    dormantProjects: 0,
    newCompanies: 0,
    matchedCompanies: 0,
    unmatchedCompanies: 0,
    warnings: [],
  };

  const nowIso = new Date().toISOString();
  const lastSeenAt = fileDate ? new Date(fileDate).toISOString() : nowIso;

  // ---------------------------------------------------------------------
  // Phase 1 — pre-fetch existing world into memory
  // ---------------------------------------------------------------------
  const { projectsByRef, projectsByName } = await loadProjectIndex(supabase);
  const { companiesByLowerName, companiesByAlias, allCompanies } =
    await loadCompanyIndex(supabase);

  // ---------------------------------------------------------------------
  // Phase 2 — collect unique company tokens needing a fuzzy lookup
  // ---------------------------------------------------------------------
  type ResolveContext = {
    rowIndex: number;
    role: CompanyRoleColumn;
    inferredType: CompanyType;
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
          rowIndex: i,
          role: def.role,
          inferredType: def.companyType,
          contact: {
            phone: nthOrNull(phoneCell, t),
            contact: nthOrNull(contactCell, t),
            email: nthOrNull(emailCell, t),
          },
          token,
        });
        // Only push to fuzzy set if no exact in-memory match exists
        const lower = token.name.toLowerCase();
        if (!companiesByLowerName.has(lower) && !companiesByAlias.has(lower)) {
          fuzzyKeys.add(token.name);
        }
      }
    }
  }

  // ---------------------------------------------------------------------
  // Phase 3 — fuzzy lookups in parallel batches
  // ---------------------------------------------------------------------
  const fuzzyResults = new Map<
    string,
    { company_id: string; similarity_score: number } | null
  >();
  const fuzzyTokens = Array.from(fuzzyKeys);
  const FUZZY_PARALLEL = 25;
  for (let i = 0; i < fuzzyTokens.length; i += FUZZY_PARALLEL) {
    const slice = fuzzyTokens.slice(i, i + FUZZY_PARALLEL);
    await Promise.all(
      slice.map(async (raw) => {
        const norm = normaliseCompanyName(raw);
        if (!norm) {
          fuzzyResults.set(raw, null);
          return;
        }
        const { data } = await supabase.rpc('find_company_by_fuzzy_name', {
          p_token: norm,
          p_threshold: 0.75,
        });
        const best =
          Array.isArray(data) && data.length > 0
            ? (data[0] as { company_id: string; similarity_score: number })
            : null;
        fuzzyResults.set(raw, best);
      }),
    );
  }

  // ---------------------------------------------------------------------
  // Phase 4 — in-memory accumulation
  // ---------------------------------------------------------------------
  const projectsToInsert: ProjectFields[] = [];
  const projectsToUpdate: ProjectFields[] = [];
  const companiesToInsert: CompanyInsert[] = [];
  const companyAliasMerges = new Map<string, Set<string>>();
  const projectCompanyLinks = new Map<string, ProjectCompanyLink>();
  const matchQueueEntries: MatchQueueEntry[] = [];
  const companyIdsByLowerName = new Map<string, string>(
    Array.from(companiesByLowerName.entries()).map(([k, v]) => [k, v.id]),
  );
  // Track companies we'll create so subsequent tokens in the same upload
  // dedupe to the same generated UUID.
  const newCompaniesByLowerName = new Map<string, string>();

  // Pre-compute resolved project per row (only rows that have a name)
  const projectIdByRowIndex = new Map<number, string>();

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const ref = pickColumn(row, ['Reference Number', 'Reference No', 'PRJ Reference']);
    const name = pickColumn(row, ['Project Name', 'Name']);
    if (!name) {
      summary.warnings.push(`row ${i}: missing Project Name`);
      continue;
    }
    const stageRaw = pickColumn(row, ['Stage']);
    const { stage, warning: stageWarning } = mapStage(stageRaw);
    if (stageWarning && summary.warnings.length < 50) {
      summary.warnings.push(`row ${i} stage: ${stageWarning}`);
    }

    const existingByRef = ref ? projectsByRef.get(ref) : null;
    const existingByName = !existingByRef ? projectsByName.get(name.toLowerCase()) : null;
    const existing = existingByRef ?? existingByName ?? null;
    const id = existing?.id ?? randomUUID();
    if (!existing) projectsByRef.set(ref ?? `__name__${name.toLowerCase()}`, { id, ref });
    projectIdByRowIndex.set(i, id);

    const fields: ProjectFields = {
      id,
      name,
      stage,
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

  // Resolve every company token and build project_companies links
  for (const ctx of resolvers) {
    const projectId = projectIdByRowIndex.get(ctx.rowIndex);
    if (!projectId) continue;
    const lower = ctx.token.name.toLowerCase();

    // 1. Exact in-memory match
    let companyId = companiesByLowerName.get(lower)?.id ?? null;
    let matchKind: 'exact' | 'alias' | 'fuzzy_high' | 'fuzzy_mid' | 'new' | null = null;
    if (companyId) matchKind = 'exact';

    // 2. Alias match
    if (!companyId) {
      const aliasHit = companiesByAlias.get(lower);
      if (aliasHit) {
        companyId = aliasHit.id;
        matchKind = 'alias';
      }
    }

    // 3. Fuzzy match (already resolved in phase 3)
    if (!companyId) {
      const fuzzy = fuzzyResults.get(ctx.token.name);
      if (fuzzy && fuzzy.similarity_score >= 0.85) {
        companyId = fuzzy.company_id;
        matchKind = 'fuzzy_high';
      } else if (fuzzy && fuzzy.similarity_score >= 0.75) {
        // Queue for admin review; do NOT link.
        matchQueueEntries.push({
          upload_id: uploadId,
          raw_name: ctx.token.name,
          suggested_company_id: fuzzy.company_id,
          similarity_score: fuzzy.similarity_score,
          status: 'pending',
        });
        matchKind = 'fuzzy_mid';
        summary.unmatchedCompanies++;
      }
    }

    // 4. Within-upload dedup: did we already plan a new company for this name?
    if (!companyId && matchKind !== 'fuzzy_mid') {
      const existingNew = newCompaniesByLowerName.get(lower);
      if (existingNew) {
        companyId = existingNew;
        // Merge aliases into the planned-new
        if (ctx.token.aliases.length > 0) {
          const set = companyAliasMerges.get(existingNew) ?? new Set<string>();
          for (const a of ctx.token.aliases) set.add(a);
          companyAliasMerges.set(existingNew, set);
        }
        matchKind = 'new';
      }
    }

    // 5. New company (planned, not yet inserted)
    if (!companyId && matchKind !== 'fuzzy_mid') {
      const id = randomUUID();
      companyId = id;
      newCompaniesByLowerName.set(lower, id);
      companiesToInsert.push({
        id,
        canonical_name: tidyCompanyName(ctx.token.name),
        company_type: ctx.inferredType,
        aliases: ctx.token.aliases,
        source: 'bnc_upload',
        current_level: 'L0',
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
      // For an existing company with new aliases, queue an alias merge
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
      const linkKey = `${projectId}|${companyId}|${ctx.role}`;
      projectCompanyLinks.set(linkKey, {
        project_id: projectId,
        company_id: companyId,
        role: ctx.role,
        raw_name_from_bnc: ctx.token.raw,
        last_seen_in_upload_id: uploadId,
        last_seen_in_upload_at: lastSeenAt,
        is_current: true,
      });
    }
  }

  summary.rowsProcessed = projectIdByRowIndex.size;

  // ---------------------------------------------------------------------
  // Phase 5 — bulk flush
  // ---------------------------------------------------------------------
  await persistRawRows(supabase, uploadId, rows);

  if (projectsToInsert.length > 0) {
    for (let i = 0; i < projectsToInsert.length; i += 200) {
      const slice = projectsToInsert.slice(i, i + 200);
      const { error } = await supabase.from('projects').insert(slice);
      if (error) summary.warnings.push(`insert projects: ${error.message}`);
    }
  }
  if (projectsToUpdate.length > 0) {
    // Upsert by id (we know the id; conflict target = pkey)
    for (let i = 0; i < projectsToUpdate.length; i += 200) {
      const slice = projectsToUpdate.slice(i, i + 200);
      const { error } = await supabase.from('projects').upsert(slice, { onConflict: 'id' });
      if (error) summary.warnings.push(`update projects: ${error.message}`);
    }
  }
  if (companiesToInsert.length > 0) {
    for (let i = 0; i < companiesToInsert.length; i += 200) {
      const slice = companiesToInsert.slice(i, i + 200);
      const { error } = await supabase.from('companies').insert(slice);
      if (error) summary.warnings.push(`insert companies: ${error.message}`);
    }
  }
  if (companyAliasMerges.size > 0) {
    // Updates aren't bulk — but typically <100 alias-merges per upload.
    for (const [id, set] of companyAliasMerges) {
      const { error } = await supabase
        .from('companies')
        .update({ aliases: Array.from(set) })
        .eq('id', id);
      if (error) summary.warnings.push(`alias merge ${id}: ${error.message}`);
    }
  }
  if (projectCompanyLinks.size > 0) {
    const links = Array.from(projectCompanyLinks.values());
    for (let i = 0; i < links.length; i += 500) {
      const slice = links.slice(i, i + 500);
      const { error } = await supabase
        .from('project_companies')
        .upsert(slice, { onConflict: 'project_id,company_id,role' });
      if (error) summary.warnings.push(`upsert project_companies: ${error.message}`);
    }
  }
  if (matchQueueEntries.length > 0) {
    for (let i = 0; i < matchQueueEntries.length; i += 500) {
      const slice = matchQueueEntries.slice(i, i + 500);
      const { error } = await supabase.from('company_match_queue').insert(slice);
      if (error) summary.warnings.push(`insert match queue: ${error.message}`);
    }
  }

  // Stage D — derived state
  const seenCompanyIds = new Set<string>();
  for (const link of projectCompanyLinks.values()) seenCompanyIds.add(link.company_id);
  if (seenCompanyIds.size > 0) {
    const ids = Array.from(seenCompanyIds);
    for (let i = 0; i < ids.length; i += 500) {
      const slice = ids.slice(i, i + 500);
      const { error } = await supabase
        .from('companies')
        .update({ has_active_projects: true })
        .in('id', slice);
      if (error) summary.warnings.push(`update has_active_projects: ${error.message}`);
    }
  }

  summary.warnings.unshift(
    `processed in ${((Date.now() - startedAt) / 1000).toFixed(1)}s`,
  );
  return summary;
}

// ---------------------------------------------------------------------------
// Pre-fetch helpers
// ---------------------------------------------------------------------------

async function loadProjectIndex(supabase: SupabaseClient): Promise<{
  projectsByRef: Map<string, ProjectIndex>;
  projectsByName: Map<string, ProjectIndex>;
}> {
  const projectsByRef = new Map<string, ProjectIndex>();
  const projectsByName = new Map<string, ProjectIndex>();
  let from = 0;
  const PAGE = 1000;
  for (;;) {
    const { data, error } = await supabase
      .from('projects')
      .select('id, bnc_reference_number, name')
      .range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    for (const r of data as Array<{ id: string; bnc_reference_number: string | null; name: string }>) {
      const idx = { id: r.id, ref: r.bnc_reference_number };
      if (r.bnc_reference_number) projectsByRef.set(r.bnc_reference_number, idx);
      projectsByName.set(r.name.toLowerCase(), idx);
    }
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return { projectsByRef, projectsByName };
}

async function loadCompanyIndex(supabase: SupabaseClient): Promise<{
  companiesByLowerName: Map<string, CompanyIndex>;
  companiesByAlias: Map<string, CompanyIndex>;
  allCompanies: Map<string, CompanyIndex>;
}> {
  const companiesByLowerName = new Map<string, CompanyIndex>();
  const companiesByAlias = new Map<string, CompanyIndex>();
  const allCompanies = new Map<string, CompanyIndex>();
  let from = 0;
  const PAGE = 1000;
  for (;;) {
    const { data, error } = await supabase
      .from('companies')
      .select('id, canonical_name, aliases')
      .range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    for (const r of data as Array<{ id: string; canonical_name: string; aliases: string[] | null }>) {
      const idx: CompanyIndex = {
        id: r.id,
        canonical: r.canonical_name,
        aliases: r.aliases ?? [],
      };
      companiesByLowerName.set(r.canonical_name.toLowerCase(), idx);
      allCompanies.set(r.id, idx);
      for (const a of idx.aliases) {
        companiesByAlias.set(a.toLowerCase(), idx);
      }
    }
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return { companiesByLowerName, companiesByAlias, allCompanies };
}

async function persistRawRows(
  supabase: SupabaseClient,
  uploadId: string,
  rows: RawRow[],
): Promise<void> {
  const BATCH = 500;
  for (let i = 0; i < rows.length; i += BATCH) {
    const slice = rows.slice(i, i + BATCH).map((row, j) => ({
      upload_id: uploadId,
      row_index: i + j,
      raw_data: row,
      project_ref: pickColumn(row, ['Reference Number', 'Reference No', 'PRJ Reference']),
    }));
    const { error } = await supabase.from('bnc_upload_rows').insert(slice);
    if (error) {
      console.warn('bnc_upload_rows insert failed:', error.message);
    }
  }
}

export { ROLE_COLUMNS };
export type { CompanyRoleColumn };

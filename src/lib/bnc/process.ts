// BNC pipeline orchestrator. Stages B–D from architecture/05-bnc-upload-sequence.md.
// (Stage A — XLSX parse — happens in parse.ts. Stage E — market_snapshots —
// deferred to M11 when something reads them.)
//
// Runs server-side in the Next.js API route. Bound by Vercel's 60s timeout.
// Migration to a Supabase Edge Function is the v1.1 perf path.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { RawRow } from './parse';
import { pickColumn, parseNumber, parseDate } from './parse';
import { tokeniseCompanyCell, nthOrNull, type CompanyToken } from './tokenise';
import { mapStage } from './stage-map';
import { normaliseCompanyName, tidyCompanyName } from './normalise';
import type { CompanyType, ProjectStage } from '@/types/domain';

type CompanyRoleColumn =
  | 'owner'
  | 'design_consultant'
  | 'main_contractor'
  | 'mep_consultant'
  | 'mep_contractor';

type RoleColumnDef = {
  role: CompanyRoleColumn;
  /** Inferred company_type when we INSERT a brand-new company from this column. */
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

export async function processBncRows(
  supabase: SupabaseClient,
  uploadId: string,
  fileDate: string | null,
  rows: RawRow[],
): Promise<ProcessSummary> {
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

  // Cache the raw rows for audit + reprocessing
  await persistRawRows(supabase, uploadId, rows);

  const seenProjectIds = new Set<string>();
  const seenCompanyIds = new Set<string>();

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    try {
      const projectId = await resolveProject(supabase, uploadId, row, fileDate, summary);
      if (!projectId) continue;
      seenProjectIds.add(projectId);

      // Update bnc_upload_rows with resolved project_id
      await supabase
        .from('bnc_upload_rows')
        .update({ resolved_project_id: projectId })
        .eq('upload_id', uploadId)
        .eq('row_index', i);

      for (const def of ROLE_COLUMNS) {
        const cell = pickColumn(row, def.nameAliases);
        const tokens = tokeniseCompanyCell(cell);
        const phoneCell = pickColumn(row, def.phoneAliases);
        const contactCell = pickColumn(row, def.contactAliases);
        const emailCell = pickColumn(row, def.emailAliases);

        for (let t = 0; t < tokens.length; t++) {
          const token = tokens[t];
          const phone = nthOrNull(phoneCell, t);
          const contact = nthOrNull(contactCell, t);
          const email = nthOrNull(emailCell, t);
          const companyId = await resolveCompany(
            supabase,
            uploadId,
            token,
            def.companyType,
            { phone, contact, email },
            summary,
          );
          if (!companyId) continue;
          seenCompanyIds.add(companyId);
          await upsertProjectCompany(supabase, projectId, companyId, def.role, token.raw, uploadId);
        }
      }
      summary.rowsProcessed++;
    } catch (err) {
      summary.rowsErrored++;
      summary.warnings.push(`row ${i}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Stage D — derived state
  if (seenCompanyIds.size > 0) {
    await supabase
      .from('companies')
      .update({ has_active_projects: true })
      .in('id', Array.from(seenCompanyIds));
  }

  return summary;
}

// ---------------------------------------------------------------------------
// Stage A cache — bnc_upload_rows
// ---------------------------------------------------------------------------

async function persistRawRows(
  supabase: SupabaseClient,
  uploadId: string,
  rows: RawRow[],
): Promise<void> {
  const BATCH = 200;
  for (let i = 0; i < rows.length; i += BATCH) {
    const slice = rows.slice(i, i + BATCH).map((row, j) => ({
      upload_id: uploadId,
      row_index: i + j,
      raw_data: row,
      project_ref: pickColumn(row, ['Reference Number', 'Reference No', 'PRJ Reference']),
    }));
    const { error } = await supabase.from('bnc_upload_rows').insert(slice);
    if (error) {
      // Rows table is best-effort — log and continue. The processor itself
      // doesn't depend on these for resolution.
      console.warn('bnc_upload_rows insert failed:', error.message);
    }
  }
}

// ---------------------------------------------------------------------------
// Stage B — project resolver
// ---------------------------------------------------------------------------

async function resolveProject(
  supabase: SupabaseClient,
  uploadId: string,
  row: RawRow,
  fileDate: string | null,
  summary: ProcessSummary,
): Promise<string | null> {
  const ref = pickColumn(row, ['Reference Number', 'Reference No', 'PRJ Reference']);
  const name = pickColumn(row, ['Project Name', 'Name']);
  if (!name) return null; // unidentifiable row

  const stageRaw = pickColumn(row, ['Stage']);
  const { stage, warning: stageWarning } = mapStage(stageRaw);
  if (stageWarning) summary.warnings.push(`stage: ${stageWarning}`);

  const projectFields = {
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
    profile_type: pickColumn(row, ['Profile Type']),
    bnc_reference_number: ref,
    est_main_contractor_award_date: parseDate(
      pickColumn(row, ['Est. Main/Infra/EPC Contractor Award Date', 'Est. Main Contractor Award Date']),
    ),
    main_contractor_award_value: parseNumber(
      pickColumn(row, ['Main/Infra/EPC Contractor Award Value', 'Main Contractor Award Value']),
    ),
    last_seen_in_upload_id: uploadId,
    last_seen_in_upload_at: fileDate ?? new Date().toISOString(),
    is_dormant: false,
    stage_last_updated_at: new Date().toISOString(),
  };

  if (ref) {
    const { data: existing } = await supabase
      .from('projects')
      .select('id')
      .eq('bnc_reference_number', ref)
      .maybeSingle();
    if (existing?.id) {
      const { error } = await supabase.from('projects').update(projectFields).eq('id', existing.id);
      if (error) throw error;
      summary.updatedProjects++;
      return existing.id;
    }
  }

  // No ref or ref didn't match — INSERT
  const { data: created, error } = await supabase
    .from('projects')
    .insert(projectFields)
    .select('id')
    .single();
  if (error) throw error;
  summary.newProjects++;
  return created.id;
}

// ---------------------------------------------------------------------------
// Stage C — company resolver
// ---------------------------------------------------------------------------

async function resolveCompany(
  supabase: SupabaseClient,
  uploadId: string,
  token: CompanyToken,
  inferredType: CompanyType,
  contact: { phone: string | null; contact: string | null; email: string | null },
  summary: ProcessSummary,
): Promise<string | null> {
  const probeRaw = token.name;
  const probeNorm = normaliseCompanyName(probeRaw);
  if (!probeNorm) return null;

  // Exact case-insensitive match first (cheap, deterministic)
  const { data: exact } = await supabase
    .from('companies')
    .select('id, aliases')
    .ilike('canonical_name', probeRaw)
    .limit(1)
    .maybeSingle();
  if (exact?.id) {
    summary.matchedCompanies++;
    if (token.aliases.length > 0) {
      await mergeAliases(supabase, exact.id, exact.aliases ?? [], token.aliases);
    }
    return exact.id;
  }

  // Fuzzy match via RPC (0025_bnc_match_rpc.sql)
  const { data: fuzzyRows } = await supabase.rpc('find_company_by_fuzzy_name', {
    p_token: probeNorm,
    p_threshold: 0.75,
  });
  const best =
    Array.isArray(fuzzyRows) && fuzzyRows.length > 0
      ? (fuzzyRows[0] as { company_id: string; similarity_score: number })
      : null;

  if (best && best.similarity_score >= 0.85) {
    summary.matchedCompanies++;
    return best.company_id;
  }

  if (best && best.similarity_score >= 0.75) {
    // Queue for admin review; do NOT link the project to the suggested
    // company — admin must approve first.
    await supabase.from('company_match_queue').insert({
      upload_id: uploadId,
      raw_name: probeRaw,
      suggested_company_id: best.company_id,
      similarity_score: best.similarity_score,
      status: 'pending',
    });
    summary.unmatchedCompanies++;
    return null;
  }

  // Below threshold — INSERT new company
  const insertPayload = {
    canonical_name: tidyCompanyName(probeRaw),
    company_type: inferredType,
    aliases: token.aliases,
    source: 'bnc_upload',
    current_level: 'L0',
    last_seen_in_upload_id: uploadId,
    last_seen_in_upload_at: new Date().toISOString(),
    key_contact_name: contact.contact,
    key_contact_phone: contact.phone,
    key_contact_email: contact.email,
  };

  const { data: created, error } = await supabase
    .from('companies')
    .insert(insertPayload)
    .select('id')
    .single();
  if (error) {
    // Race: someone else inserted same name between our probe and insert.
    // Fall back to a fresh ilike lookup.
    if (error.code === '23505') {
      const { data: refound } = await supabase
        .from('companies')
        .select('id')
        .ilike('canonical_name', probeRaw)
        .limit(1)
        .maybeSingle();
      if (refound?.id) {
        summary.matchedCompanies++;
        return refound.id;
      }
    }
    throw error;
  }
  summary.newCompanies++;
  return created.id;
}

async function mergeAliases(
  supabase: SupabaseClient,
  companyId: string,
  existingAliases: string[],
  newAliases: string[],
): Promise<void> {
  const toAdd = newAliases.filter(
    (a) => !existingAliases.some((e) => e.toLowerCase() === a.toLowerCase()),
  );
  if (toAdd.length === 0) return;
  await supabase
    .from('companies')
    .update({ aliases: [...existingAliases, ...toAdd] })
    .eq('id', companyId);
}

// ---------------------------------------------------------------------------
// Stage C cont. — project_companies upsert
// ---------------------------------------------------------------------------

async function upsertProjectCompany(
  supabase: SupabaseClient,
  projectId: string,
  companyId: string,
  role: CompanyRoleColumn,
  rawName: string,
  uploadId: string,
): Promise<void> {
  const { error } = await supabase
    .from('project_companies')
    .upsert(
      {
        project_id: projectId,
        company_id: companyId,
        role,
        raw_name_from_bnc: rawName,
        last_seen_in_upload_id: uploadId,
        last_seen_in_upload_at: new Date().toISOString(),
        is_current: true,
      },
      { onConflict: 'project_id,company_id,role' },
    );
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// Helpers re-exported for tests
// ---------------------------------------------------------------------------

export { ROLE_COLUMNS };
export type { CompanyRoleColumn };

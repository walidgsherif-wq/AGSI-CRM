#!/usr/bin/env -S pnpm tsx
/* eslint-disable no-console */
/**
 * scripts/import-bnc.ts
 *
 * Local CLI runner for the BNC upload pipeline. Bypasses the Vercel 60s
 * function ceiling by running the same TypeScript pipeline against your
 * Supabase project directly from your machine.
 *
 * Usage:
 *   pnpm tsx scripts/import-bnc.ts <path-to-xlsx> <YYYY-MM-DD> [--reprocess]
 *
 * Reads NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY from
 * .env.local. Inserts a bnc_uploads row, runs the parser + resolver,
 * persists results, prints a summary.
 *
 * Future weekly uploads can use the web UI again once we migrate
 * processing to a Supabase Edge Function (M5 polish task).
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { parseBncWorkbook } from '../src/lib/bnc/parse';
import { processBncRows } from '../src/lib/bnc/process';

function fail(msg: string): never {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

async function main() {
  const args = process.argv.slice(2);
  const reprocess = args.includes('--reprocess');
  const positional = args.filter((a) => !a.startsWith('--'));
  if (positional.length < 2) {
    console.error(
      'Usage: pnpm tsx scripts/import-bnc.ts <path-to-xlsx> <YYYY-MM-DD> [--reprocess]',
    );
    process.exit(1);
  }
  const [filePath, fileDate] = positional;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(fileDate)) {
    fail(`File date must be YYYY-MM-DD. Got: ${fileDate}`);
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    fail(
      'Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. Run with --env-file=.env.local or `pnpm import:bnc`.',
    );
  }

  const absPath = resolve(filePath);
  console.log(`→ Reading ${absPath}`);
  const buffer = readFileSync(absPath);
  console.log(`→ ${(buffer.byteLength / 1024 / 1024).toFixed(1)} MB`);

  console.log('→ Parsing workbook…');
  const t0 = Date.now();
  const { rows, headerRowIndex } = parseBncWorkbook(
    buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
  );
  console.log(
    `→ Parsed ${rows.length} rows (header at index ${headerRowIndex}) in ${((Date.now() - t0) / 1000).toFixed(1)}s`,
  );

  const supabase = createClient(url, serviceKey, {
    auth: { persistSession: false },
  });

  // Find an admin to attribute the upload to
  const { data: admin } = await supabase
    .from('profiles')
    .select('id')
    .eq('role', 'admin')
    .eq('is_active', true)
    .limit(1)
    .single();
  if (!admin) {
    fail('No active admin profile found. Sign in once to the web app first.');
  }

  // Duplicate guard
  if (!reprocess) {
    const { data: dupes } = await supabase
      .from('bnc_uploads')
      .select('id, status')
      .eq('file_date', fileDate)
      .limit(1);
    if (dupes && dupes.length > 0) {
      fail(
        `An upload for ${fileDate} already exists (id ${dupes[0].id}, status ${dupes[0].status}). Re-run with --reprocess to add a new row.`,
      );
    }
  }

  console.log('→ Inserting bnc_uploads row…');
  const filename = absPath.split('/').pop() ?? 'unknown.xlsx';
  const { data: uploadRow, error: insertErr } = await supabase
    .from('bnc_uploads')
    .insert({
      filename,
      storage_path: `local-cli/${Date.now()}-${filename}`,
      uploaded_by: admin.id,
      file_date: fileDate,
      status: 'processing',
    })
    .select('id')
    .single();
  if (insertErr || !uploadRow) {
    fail(`Could not insert upload row: ${insertErr?.message ?? 'unknown'}`);
  }
  const uploadId = uploadRow.id as string;
  console.log(`→ upload_id ${uploadId}`);

  console.log('→ Running pipeline (this can take a few minutes for large files)…');
  const t1 = Date.now();
  try {
    const summary = await processBncRows(supabase, uploadId, fileDate, rows);

    await supabase
      .from('bnc_uploads')
      .update({
        status: 'completed',
        row_count: summary.rowsTotal,
        new_projects: summary.newProjects,
        updated_projects: summary.updatedProjects,
        dormant_projects: summary.dormantProjects,
        new_companies: summary.newCompanies,
        matched_companies: summary.matchedCompanies,
        unmatched_companies: summary.unmatchedCompanies,
        error_log: summary.warnings.length > 0 ? summary.warnings.slice(0, 50).join('\n') : null,
      })
      .eq('id', uploadId);

    const elapsed = ((Date.now() - t1) / 1000).toFixed(1);
    console.log('');
    console.log(`✓ Completed in ${elapsed}s`);
    console.log('');
    console.log(`  Rows:                ${summary.rowsTotal}`);
    console.log(`  Rows processed:      ${summary.rowsProcessed}`);
    console.log(`  Rows errored:        ${summary.rowsErrored}`);
    console.log(`  New projects:        ${summary.newProjects}`);
    console.log(`  Updated projects:    ${summary.updatedProjects}`);
    console.log(`  New companies:       ${summary.newCompanies}`);
    console.log(`  Matched companies:   ${summary.matchedCompanies}`);
    console.log(`  Unmatched (review):  ${summary.unmatchedCompanies}`);
    console.log('');
    if (summary.warnings.length > 0) {
      console.log(`  First ${Math.min(10, summary.warnings.length)} warnings:`);
      for (const w of summary.warnings.slice(0, 10)) console.log(`    - ${w}`);
    }
    console.log('');
    console.log(`  Open in app: /admin/uploads/${uploadId}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await supabase
      .from('bnc_uploads')
      .update({ status: 'failed', error_log: msg })
      .eq('id', uploadId);
    fail(`Pipeline error: ${msg}`);
  }
}

main().catch((err) => fail(err instanceof Error ? err.message : String(err)));

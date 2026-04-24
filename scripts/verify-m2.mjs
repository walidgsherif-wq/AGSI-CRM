// M2 verification script — run locally against your Supabase project.
//
// Usage:
//   node --env-file=.env.local scripts/verify-m2.mjs
//   # or via pnpm:
//   pnpm verify:m2
//
// What it checks:
//   1. All 23 expected tables exist (via a metadata query with service role)
//   2. Seed data is loaded (playbook_targets=12, stagnation_rules=6, etc.)
//   3. RLS blocks anonymous reads on every table
//   4. change_company_level() function is callable
//
// Exits 0 on pass, 1 on any failure.

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY     = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !ANON_KEY || !SERVICE_KEY) {
  console.error('Missing env vars. Run with: node --env-file=.env.local scripts/verify-m2.mjs');
  process.exit(1);
}

const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
const anon  = createClient(SUPABASE_URL, ANON_KEY,    { auth: { persistSession: false } });

let pass = 0;
let fail = 0;
const failures = [];

function ok(msg)   { pass++; console.log(`  ✓ ${msg}`); }
function bad(msg)  { fail++; failures.push(msg); console.error(`  ✗ ${msg}`); }

// ─────────────────────────────────────────────────────────────────────────
console.log('\n[1/4] Seed data (service role — bypasses RLS)');

const SEED_EXPECTATIONS = [
  ['playbook_targets',       12],
  ['stagnation_rules',        6],
  ['ecosystem_point_scale',  15],
  ['city_lookup',            15],
  ['app_settings',           19],
];

for (const [table, expected] of SEED_EXPECTATIONS) {
  const { count, error } = await admin.from(table).select('*', { count: 'exact', head: true });
  if (error) {
    bad(`${table}: query error — ${error.message}`);
  } else if (count !== expected) {
    bad(`${table}: expected ${expected} rows, got ${count}`);
  } else {
    ok(`${table}: ${count} rows`);
  }
}

// ─────────────────────────────────────────────────────────────────────────
console.log('\n[2/4] All expected tables exist and accept a service-role SELECT');

const TABLES = [
  'profiles', 'companies', 'level_history', 'projects', 'project_companies',
  'engagements', 'tasks', 'notes', 'documents',
  'playbook_targets', 'member_targets', 'kpi_actuals_daily',
  'bnc_uploads', 'bnc_upload_rows', 'company_match_queue', 'market_snapshots',
  'stagnation_rules', 'notifications', 'composition_drift_log',
  'app_settings', 'audit_events',
  'ecosystem_point_scale', 'ecosystem_events', 'ecosystem_awareness_current',
  'leadership_reports', 'leadership_report_stakeholders',
  'city_lookup',
];

for (const table of TABLES) {
  const { error } = await admin.from(table).select('*', { count: 'exact', head: true });
  if (error) bad(`${table}: ${error.message}`);
  else ok(`${table}`);
}

// ─────────────────────────────────────────────────────────────────────────
console.log('\n[3/4] RLS blocks anonymous reads on every table');

// Note: Supabase's PostgREST returns 200 + empty array when RLS denies a
// SELECT, not 403. Empty result == blocked.
// app_settings is intentionally excluded from strict RLS (has a whitelist
// policy with an empty anon role match — it will still return 0 rows for
// anon because no policy grants anon access.)

for (const table of TABLES) {
  const { data, error } = await anon.from(table).select('*').limit(1);
  if (error && !error.message.includes('permission')) {
    bad(`anon/${table}: unexpected error — ${error.message}`);
  } else if (Array.isArray(data) && data.length === 0) {
    ok(`anon/${table}: 0 rows (blocked)`);
  } else if (!data || data.length === 0) {
    ok(`anon/${table}: blocked`);
  } else {
    bad(`anon/${table}: returned ${data.length} rows — RLS leak!`);
  }
}

// ─────────────────────────────────────────────────────────────────────────
console.log('\n[4/4] RPC change_company_level is installed');

// We call it with a fake UUID and expect "Company ... not found" — proves
// the function exists and runs, without actually mutating anything.
const { error: rpcError } = await admin.rpc('change_company_level', {
  p_company_id: '00000000-0000-0000-0000-000000000000',
  p_to_level:   'L1',
});

if (rpcError && rpcError.message.includes('not found')) {
  ok('change_company_level exists and executes');
} else if (rpcError) {
  bad(`change_company_level: unexpected error — ${rpcError.message}`);
} else {
  bad('change_company_level: no error on nonexistent company — unexpected');
}

// ─────────────────────────────────────────────────────────────────────────
console.log(`\n${pass} passed, ${fail} failed.`);
if (fail > 0) {
  console.error('\nFailures:');
  failures.forEach((f) => console.error(`  • ${f}`));
  process.exit(1);
}
console.log('\nM2 schema + seed + RLS verified.');

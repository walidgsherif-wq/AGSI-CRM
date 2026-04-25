// POST /api/bnc/upload
// Multipart endpoint: receives the BNC xlsx, persists to Storage, inserts
// bnc_uploads row, kicks off processing inline.
//
// Admin-only. Caller's JWT is checked via the cookie-bound supabase client;
// the actual writes go through the service-role client because storage
// uploads + multi-table writes are easier without RLS contortions.
//
// Soft cap: ~500 rows fits Vercel's 60s budget. Larger files should migrate
// to a Supabase Edge Function (deferred).

import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getCurrentUser } from '@/lib/auth/get-user';
import { parseBncWorkbook, parseDate } from '@/lib/bnc/parse';
import { processBncRows } from '@/lib/bnc/process';

export const runtime = 'nodejs';
export const maxDuration = 60;

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
}

export async function POST(req: NextRequest) {
  // 1. AuthN/Z — must be admin
  const user = await getCurrentUser();
  if (user.role !== 'admin') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  // 2. Read multipart body
  const form = await req.formData();
  const file = form.get('file');
  const fileDateRaw = String(form.get('file_date') ?? '');
  const reprocess = form.get('reprocess') === 'on';

  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'No file provided.' }, { status: 400 });
  }
  if (!file.name.toLowerCase().endsWith('.xlsx')) {
    return NextResponse.json({ error: 'File must be .xlsx' }, { status: 400 });
  }
  if (file.size > 50 * 1024 * 1024) {
    return NextResponse.json({ error: 'File exceeds 50MB.' }, { status: 400 });
  }
  const fileDate = parseDate(fileDateRaw);
  if (!fileDate) {
    return NextResponse.json(
      { error: 'file_date is required (YYYY-MM-DD or DD/MM/YYYY).' },
      { status: 400 },
    );
  }

  const admin = adminClient();

  // 3. Duplicate-file_date guard
  if (!reprocess) {
    const { data: dupes } = await admin
      .from('bnc_uploads')
      .select('id, status')
      .eq('file_date', fileDate)
      .limit(1);
    if (dupes && dupes.length > 0) {
      return NextResponse.json(
        {
          error: `An upload for ${fileDate} already exists (id ${dupes[0].id}). Tick "reprocess intentional" to upload again.`,
          duplicate_of: dupes[0].id,
        },
        { status: 409 },
      );
    }
  }

  // 4. Persist to Storage
  const stamp = Date.now();
  const storagePath = `${fileDate}/${stamp}-${file.name}`;
  const arrayBuffer = await file.arrayBuffer();

  const { error: storeErr } = await admin.storage
    .from('bnc-uploads')
    .upload(storagePath, arrayBuffer, {
      contentType: file.type || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      upsert: false,
    });
  if (storeErr) {
    return NextResponse.json(
      { error: `Storage upload failed: ${storeErr.message}` },
      { status: 500 },
    );
  }

  // 5. Insert bnc_uploads row
  const { data: uploadRow, error: insertErr } = await admin
    .from('bnc_uploads')
    .insert({
      filename: file.name,
      storage_path: storagePath,
      uploaded_by: user.id,
      file_date: fileDate,
      status: 'processing',
    })
    .select('id')
    .single();
  if (insertErr || !uploadRow) {
    return NextResponse.json(
      { error: insertErr?.message ?? 'Failed to record upload.' },
      { status: 500 },
    );
  }

  const uploadId = uploadRow.id as string;

  // 6. Parse + process inline
  try {
    const { rows } = parseBncWorkbook(arrayBuffer);
    const summary = await processBncRows(admin, uploadId, fileDate, rows);

    await admin
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

    // In-app notification to all admins
    const { data: admins } = await admin.from('profiles').select('id').eq('role', 'admin');
    if (admins && admins.length > 0) {
      await admin.from('notifications').insert(
        admins.map((a: { id: string }) => ({
          recipient_id: a.id,
          notification_type: 'upload_complete',
          subject: `BNC upload completed (${file.name})`,
          body: `${summary.newProjects} new / ${summary.updatedProjects} updated projects, ${summary.unmatchedCompanies} unmatched companies pending review.`,
          link_url: `/admin/uploads/${uploadId}`,
        })),
      );
    }

    return NextResponse.json({ ok: true, upload_id: uploadId, summary });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await admin
      .from('bnc_uploads')
      .update({ status: 'failed', error_log: msg })
      .eq('id', uploadId);

    const { data: admins } = await admin.from('profiles').select('id').eq('role', 'admin');
    if (admins && admins.length > 0) {
      await admin.from('notifications').insert(
        admins.map((a: { id: string }) => ({
          recipient_id: a.id,
          notification_type: 'upload_failed',
          subject: `BNC upload failed (${file.name})`,
          body: msg.slice(0, 500),
          link_url: `/admin/uploads/${uploadId}`,
        })),
      );
    }

    return NextResponse.json({ error: msg, upload_id: uploadId }, { status: 500 });
  }
}

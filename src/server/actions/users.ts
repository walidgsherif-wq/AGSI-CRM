'use server';

import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { revalidatePath } from 'next/cache';
import type { Role } from '@/types/domain';
import { ROLES } from '@/types/domain';
import { serverComponentCookies } from '@/lib/supabase/cookie-adapter';

async function assertCallerIsAdmin() {
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: serverComponentCookies(cookies()) },
  );
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('not authenticated');
  const { data: profile } = await supabase
    .from('profiles')
    .select('role, is_active')
    .eq('id', user.id)
    .single();
  if (!profile || profile.role !== 'admin' || !profile.is_active) {
    throw new Error('forbidden');
  }
  return user.id;
}

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
}

/**
 * Invite-only signup, Google-OAuth flavour. Two paths:
 *
 * 1. New email — calls supabase.auth.admin.createUser({email_confirm:
 *    true}) to provision auth.users + profile WITHOUT sending an
 *    email. The teammate then signs in at /login with Google using
 *    that exact address; Supabase links the Google identity to the
 *    pre-created auth.users row by matching email. Role + attribution
 *    live in APP_METADATA (admin-only, not user-editable).
 *
 * 2. Already-registered email — no-op on auth, just acknowledges and
 *    tells the admin the user is already provisioned.
 *
 * The 0055 migration tightened the on_auth_user_created trigger to
 * only bootstrap the initial admin — every other auth.users insert
 * relies on this handler to create the profile. Anyone who manages to
 * OAuth without a matching profile is bounced by get-user.ts
 * (?error=profile_missing).
 */
export async function inviteUser(formData: FormData) {
  const callerId = await assertCallerIsAdmin();
  const email = String(formData.get('email') ?? '').trim().toLowerCase();
  const role = String(formData.get('role') ?? '') as Role;
  const fullName = String(formData.get('full_name') ?? '').trim();

  if (!email || !fullName) {
    return { error: 'Email and full name are required.' };
  }
  if (!(ROLES as readonly string[]).includes(role)) {
    return { error: 'Invalid role.' };
  }

  const admin = adminClient();

  // Pre-check: do we already have a profile (and therefore an auth.users
  // row) for this email? Cheaper than admin.listUsers + email filter.
  const { data: existingProfile } = await admin
    .from('profiles')
    .select('id, full_name, role, is_active')
    .eq('email', email)
    .maybeSingle<{
      id: string;
      full_name: string;
      role: Role;
      is_active: boolean;
    }>();

  if (existingProfile) {
    return {
      ok: true,
      status: 'resent' as const,
      message:
        `${existingProfile.full_name} is already provisioned ` +
        `(${ROLE_LABEL_INTERNAL(existingProfile.role)}). They can sign in at /login with Google using ${email}.`,
    };
  }

  const invitedAt = new Date().toISOString();

  // Create the auth.users row pre-confirmed so Google OAuth can link
  // by email without an email-verification round-trip. No email is
  // sent. Role + attribution stamped into app_metadata (admin-only;
  // user sessions cannot mutate this).
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: { full_name: fullName },
    app_metadata: {
      role,
      full_name: fullName,
      invited_by: callerId,
      invited_at: invitedAt,
    },
  });
  if (createErr || !created?.user) {
    return { error: createErr?.message ?? 'Provisioning failed' };
  }

  // Insert the profile directly. The 0055 trigger no longer
  // auto-creates a default-role profile for non-bootstrap inserts, so
  // this is now the only path that grants profile + role.
  const { error: profileErr } = await admin.from('profiles').upsert(
    {
      id: created.user.id,
      email,
      full_name: fullName,
      role,
      is_active: true,
      invited_by: callerId,
      invited_at: invitedAt,
    },
    { onConflict: 'id' },
  );
  if (profileErr) {
    return { error: `Account created, but profile creation failed: ${profileErr.message}` };
  }

  revalidatePath('/admin/users');
  return {
    ok: true,
    status: 'invited' as const,
    userId: created.user.id,
    message: `${fullName} provisioned. Tell them to sign in at /login with Google using ${email}.`,
  };
}

// Small local helper — avoids importing the full ROLE_LABEL map just
// for one fallback string in the existing-user path.
function ROLE_LABEL_INTERNAL(r: Role): string {
  return r.replace(/_/g, ' ');
}

export async function setUserRole(userId: string, role: Role) {
  await assertCallerIsAdmin();
  if (!(ROLES as readonly string[]).includes(role)) {
    throw new Error('invalid role');
  }
  const { error } = await adminClient().from('profiles').update({ role }).eq('id', userId);
  if (error) throw new Error(error.message);
  revalidatePath('/admin/users');
}

export async function setUserActive(userId: string, isActive: boolean) {
  await assertCallerIsAdmin();
  const { error } = await adminClient()
    .from('profiles')
    .update({ is_active: isActive })
    .eq('id', userId);
  if (error) throw new Error(error.message);
  revalidatePath('/admin/users');
}

/**
 * Permanently delete a user — auth.users + profiles in one shot.
 *
 * Use case: testing the invite/access flow. After verifying the
 * trigger / invite path works, the admin may want to delete a test
 * user and re-invite the same email instead of finding a fresh one.
 *
 * Cascades: profiles.id → auth.users.id ON DELETE CASCADE (the
 * profile row disappears with the auth row). Every other reference
 * (companies.owner_id, engagements.created_by, notes.author_id,
 * documents.uploaded_by, tasks.owner_id / assigned_by_id, …) is
 * ON DELETE SET NULL — those rows survive but their owner/author
 * fields go null. We surface the orphan counts in the result so the
 * admin sees what just happened.
 *
 * Guards:
 *  - admin only (assertCallerIsAdmin)
 *  - cannot delete self
 */
export async function deleteUser(userId: string) {
  const callerId = await assertCallerIsAdmin();
  if (userId === callerId) {
    return { error: 'You cannot delete your own account.' };
  }

  const admin = adminClient();

  // Count what's about to be orphaned. Service-role bypasses RLS, so
  // the counts are accurate even if the caller couldn't see all rows.
  const [companies, engagements, tasksOwned, notes, documents] = await Promise.all([
    admin.from('companies').select('id', { count: 'exact', head: true }).eq('owner_id', userId),
    admin.from('engagements').select('id', { count: 'exact', head: true }).eq('created_by', userId),
    admin.from('tasks').select('id', { count: 'exact', head: true }).eq('owner_id', userId),
    admin.from('notes').select('id', { count: 'exact', head: true }).eq('author_id', userId),
    admin.from('documents').select('id', { count: 'exact', head: true }).eq('uploaded_by', userId),
  ]);

  // Fetch identity for the confirmation message before the row goes away.
  const { data: target } = await admin
    .from('profiles')
    .select('email, full_name')
    .eq('id', userId)
    .maybeSingle<{ email: string; full_name: string }>();

  const { error: delErr } = await admin.auth.admin.deleteUser(userId);
  if (delErr) {
    return { error: `Delete failed: ${delErr.message}` };
  }

  revalidatePath('/admin/users');
  return {
    ok: true,
    deletedEmail: target?.email ?? null,
    deletedName: target?.full_name ?? null,
    orphaned: {
      companies: companies.count ?? 0,
      engagements: engagements.count ?? 0,
      tasks: tasksOwned.count ?? 0,
      notes: notes.count ?? 0,
      documents: documents.count ?? 0,
    },
  };
}

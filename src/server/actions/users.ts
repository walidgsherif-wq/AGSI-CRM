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
 * Invite-only signup, Google-OAuth flavour. H8 fix: lazy provisioning.
 *
 * Old flow (PR #60) pre-created an auth.users row + a profile keyed
 * to that row's UUID. Google OAuth couldn't claim the pre-created
 * row by email — the invitee either got a 'user already registered'
 * error or Supabase minted a fresh auth.users row, orphaning the
 * pre-provisioned profile. The teammate then landed on the
 * profile_missing screen even though they were "invited".
 *
 * Now: this action just stashes the invite metadata in invited_users
 * (0063). No auth.users insert. No profile insert. When the invitee
 * signs in with Google for the first time, Supabase mints a fresh
 * auth.users row + Google identity (no collision possible because
 * nothing pre-existed for that email). /auth/callback then calls
 * claim_invited_profile(email, oauth_user_id) which atomically
 * creates the profile with the real OAuth id and deletes the invite
 * row.
 *
 * Two paths:
 *   1. Already-provisioned (profile exists) — no-op; just remind
 *      the admin that they can sign in.
 *   2. New email — INSERT into invited_users.
 *
 * Re-invite of an email that already has a pending invited_users row
 * goes through the ON CONFLICT branch: update role / full_name /
 * invited_by / invited_at so an admin can correct a mistake before
 * the invitee first signs in.
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

  // Pre-check: is this email already an active teammate?
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

  // Upsert into invited_users. Re-invites for the same email overwrite
  // role / full_name / invited_by / invited_at so an admin can correct
  // a mistake before the invitee first signs in.
  const { error: inviteErr } = await admin.from('invited_users').upsert(
    {
      email,
      role,
      full_name: fullName,
      invited_by: callerId,
      invited_at: new Date().toISOString(),
    },
    { onConflict: 'email' },
  );
  if (inviteErr) {
    return { error: `Invite failed: ${inviteErr.message}` };
  }

  revalidatePath('/admin/users');
  return {
    ok: true,
    status: 'invited' as const,
    message: `${fullName} added to the invite list. Tell them to sign in at /login with Google using ${email}.`,
  };
}

// Small local helper — avoids importing the full ROLE_LABEL map just
// for one fallback string in the existing-user path.
function ROLE_LABEL_INTERNAL(r: Role): string {
  return r.replace(/_/g, ' ');
}

/**
 * Revoke a pending invitation from the invited_users allowlist.
 * Admin-only (matches the /admin/users page gate). The row in
 * invited_users is the only artefact; no auth.users / profiles
 * exists yet, so this is a single-table delete with no orphan
 * cleanup. After first sign-in, the row is gone — revoking after
 * that is a no-op.
 */
export async function revokeInvite(email: string) {
  await assertCallerIsAdmin();
  const normalised = email.trim().toLowerCase();
  if (!normalised) return { error: 'Email required.' };

  const { error } = await adminClient()
    .from('invited_users')
    .delete()
    .eq('email', normalised);
  if (error) return { error: error.message };

  revalidatePath('/admin/users');
  return { ok: true as const };
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

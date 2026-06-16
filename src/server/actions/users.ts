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
 * Invite-only signup. Two paths:
 *
 * 1. New email — calls supabase.auth.admin.inviteUserByEmail (creates
 *    auth.users + sends the magic-link email), then stamps the role +
 *    attribution into APP_METADATA (admin-only, not user-editable;
 *    user_metadata is editable via session, app_metadata isn't), then
 *    INSERTs the profile directly with the admin-chosen role.
 *
 * 2. Already-registered email — resends a fresh magic-link via
 *    generateLink({ type: 'magiclink' }) so the admin doesn't see a
 *    silent no-op. The UI distinguishes the two paths in its success
 *    message.
 *
 * The 0055 migration tightened the on_auth_user_created trigger to
 * only bootstrap the initial admin — every other invite is on this
 * handler's shoulders. Anyone whose auth.users row exists without a
 * matching profile is bounced by get-user.ts (?error=profile_missing).
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
  // Leadership is read-only everywhere — it's a valid role to invite,
  // but the four ops roles cover the spec. Allow all four.

  const admin = adminClient();
  const redirectTo = `${process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'}/auth/callback`;

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
    // Already a teammate — resend a fresh sign-in link instead of the
    // silent no-op the old handler returned.
    const { error: linkErr } = await admin.auth.admin.generateLink({
      type: 'magiclink',
      email,
      options: { redirectTo },
    });
    if (linkErr) {
      return { error: `Could not re-send sign-in link: ${linkErr.message}` };
    }
    return {
      ok: true,
      status: 'resent' as const,
      message:
        `${existingProfile.full_name} already has an AGSI account ` +
        `(${ROLE_LABEL_INTERNAL(existingProfile.role)}). A fresh sign-in link was sent.`,
    };
  }

  // New email — create the auth user + send the invite email.
  const { data: invited, error: inviteErr } = await admin.auth.admin.inviteUserByEmail(email, {
    // user_metadata: display name only. The user CAN edit this from
    // their session, which is fine — it's display-only.
    data: { full_name: fullName },
    redirectTo,
  });
  if (inviteErr || !invited?.user) {
    return { error: inviteErr?.message ?? 'Invite failed' };
  }

  const invitedAt = new Date().toISOString();

  // Stamp role + attribution into APP_METADATA (admin-only; user
  // sessions cannot mutate this). This is the trustworthy source of
  // role provenance even before the profile insert below.
  const { error: metaErr } = await admin.auth.admin.updateUserById(invited.user.id, {
    app_metadata: {
      role,
      full_name: fullName,
      invited_by: callerId,
      invited_at: invitedAt,
    },
  });
  if (metaErr) {
    return { error: `Invite sent, but role assignment failed: ${metaErr.message}` };
  }

  // Insert the profile directly. The 0055 trigger no longer
  // auto-creates a default-role profile for non-bootstrap inserts, so
  // this is now the only path that grants profile + role.
  const { error: profileErr } = await admin.from('profiles').upsert(
    {
      id: invited.user.id,
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
    return { error: `Invite sent, but profile creation failed: ${profileErr.message}` };
  }

  revalidatePath('/admin/users');
  return {
    ok: true,
    status: 'invited' as const,
    userId: invited.user.id,
    message: `Invite sent to ${email}. They will receive an email shortly.`,
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

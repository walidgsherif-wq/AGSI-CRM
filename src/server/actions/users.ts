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
 * Invites a user via Supabase admin API. On accept, the 0024 trigger
 * creates their profile row. We then update the role + mark invited_at.
 */
export async function inviteUser(formData: FormData) {
  await assertCallerIsAdmin();
  const email = String(formData.get('email') ?? '').trim();
  const role = String(formData.get('role') ?? '') as Role;
  const fullName = String(formData.get('full_name') ?? '').trim();

  if (!email || !fullName) {
    return { error: 'Email and name required.' };
  }
  if (!(ROLES as readonly string[]).includes(role)) {
    return { error: 'Invalid role.' };
  }

  const admin = adminClient();

  const { data: invited, error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, {
    data: { full_name: fullName, invited_role: role },
    redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'}/auth/callback`,
  });
  if (inviteError || !invited?.user) {
    return { error: inviteError?.message ?? 'Invite failed' };
  }

  // The 0024 trigger created a profile row with role=bd_manager (default).
  // Upgrade to the admin-selected role and stamp invited_at.
  const { error: updateError } = await admin
    .from('profiles')
    .update({
      role,
      full_name: fullName,
      invited_at: new Date().toISOString(),
    })
    .eq('id', invited.user.id);

  if (updateError) {
    return { error: `Invited, but profile update failed: ${updateError.message}` };
  }

  revalidatePath('/admin/users');
  return { ok: true, userId: invited.user.id };
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

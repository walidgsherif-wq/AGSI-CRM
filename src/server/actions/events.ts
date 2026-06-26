'use server';

import { revalidatePath } from 'next/cache';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { serverComponentCookies } from '@/lib/supabase/cookie-adapter';
import { getCurrentUser } from '@/lib/auth/get-user';
import { eventCreateSchema, eventUpdateSchema } from '@/lib/zod/event';

function supabase() {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
    { cookies: serverComponentCookies(cookies()) },
  );
}

function rawFromForm(formData: FormData) {
  const get = (k: string) => {
    const v = formData.get(k);
    return v === null ? '' : String(v);
  };
  return {
    event_name: get('event_name'),
    event_date: get('event_date'),
    event_type: get('event_type'),
    website: get('website'),
    value_note: get('value_note'),
    feedback: get('feedback'),
  };
}

/** Create an attendance row for the caller. member_id is stamped from
 *  the session — never from the form — and RLS WITH CHECK enforces it. */
export async function createEvent(formData: FormData) {
  const user = await getCurrentUser();
  const parsed = eventCreateSchema.safeParse(rawFromForm(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues.map((i) => i.message).join('; ') };
  }

  const { error } = await supabase()
    .from('event_attendance')
    .insert({ ...parsed.data, member_id: user.id });
  if (error) return { error: error.message };

  revalidatePath('/events');
  revalidatePath('/dashboard');
  return { ok: true as const };
}

/** Update an attendance row. RLS permits the row owner OR admin. */
export async function updateEvent(formData: FormData) {
  await getCurrentUser();
  const id = String(formData.get('id') ?? '');
  const parsed = eventUpdateSchema.safeParse({
    id,
    ...rawFromForm(formData),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues.map((i) => i.message).join('; ') };
  }
  const { id: _id, ...patch } = parsed.data;

  const { error } = await supabase()
    .from('event_attendance')
    .update(patch)
    .eq('id', id);
  if (error) return { error: error.message };

  revalidatePath('/events');
  revalidatePath('/dashboard');
  return { ok: true as const };
}

/** Delete an attendance row. RLS permits the row owner OR admin. */
export async function deleteEvent(eventId: string) {
  await getCurrentUser();
  const { error } = await supabase()
    .from('event_attendance')
    .delete()
    .eq('id', eventId);
  if (error) return { error: error.message };

  revalidatePath('/events');
  revalidatePath('/dashboard');
  return { ok: true as const };
}

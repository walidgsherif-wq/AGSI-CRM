'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { serverComponentCookies } from '@/lib/supabase/cookie-adapter';
import { getCurrentUser } from '@/lib/auth/get-user';
import { projectCreateSchema, projectUpdateSchema } from '@/lib/zod/project';

function supabaseFromRequest() {
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
    name: get('name'),
    project_type: get('project_type'),
    stage: get('stage') || 'concept',
    value_aed: get('value_aed'),
    value_usd: get('value_usd'),
    city: get('city'),
    location: get('location'),
    sector: get('sector'),
    industry: get('industry'),
    estimated_completion_date: get('estimated_completion_date'),
    completion_percentage: get('completion_percentage'),
    agsi_priority: get('agsi_priority'),
    agsi_internal_notes: get('agsi_internal_notes'),
  };
}

export async function createProject(formData: FormData) {
  const user = await getCurrentUser();
  if (user.role === 'leadership') {
    return { error: 'Leadership cannot create projects.' };
  }

  const parsed = projectCreateSchema.safeParse(rawFromForm(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') };
  }

  const supabase = supabaseFromRequest();
  const { data: row, error } = await supabase
    .from('projects')
    .insert(parsed.data)
    .select('id')
    .single();

  if (error) {
    return { error: error.message };
  }

  revalidatePath('/projects');
  redirect(`/projects/${row.id}`);
}

export async function updateProject(formData: FormData) {
  const user = await getCurrentUser();
  if (user.role === 'leadership') {
    return { error: 'Leadership cannot edit projects.' };
  }

  const id = String(formData.get('id') ?? '');
  if (!id) return { error: 'Missing id.' };

  const parsed = projectUpdateSchema.safeParse({ id, ...rawFromForm(formData) });
  if (!parsed.success) {
    return { error: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') };
  }

  const { id: _id, ...update } = parsed.data;
  const supabase = supabaseFromRequest();
  const { error } = await supabase.from('projects').update(update).eq('id', id);
  if (error) return { error: error.message };

  revalidatePath('/projects');
  revalidatePath(`/projects/${id}`);
  return { ok: true };
}

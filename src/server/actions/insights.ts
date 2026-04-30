'use server';

import { revalidatePath } from 'next/cache';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { serverComponentCookies } from '@/lib/supabase/cookie-adapter';
import { getCurrentUser } from '@/lib/auth/get-user';

function supabase() {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
    { cookies: serverComponentCookies(cookies()) },
  );
}

export async function generateMarketSnapshot(uploadId: string) {
  const user = await getCurrentUser();
  if (user.role !== 'admin') return { error: 'admin only' };
  const { error } = await supabase().rpc('generate_market_snapshot', {
    p_upload_id: uploadId,
  });
  if (error) return { error: error.message };
  revalidatePath(`/admin/uploads/${uploadId}`);
  revalidatePath('/insights');
  return { ok: true };
}

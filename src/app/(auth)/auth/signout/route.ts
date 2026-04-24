import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';
import { mutableCookies } from '@/lib/supabase/cookie-adapter';

export async function POST(req: NextRequest) {
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: mutableCookies(cookies()) },
  );
  await supabase.auth.signOut();
  return NextResponse.redirect(new URL('/login', req.url));
}

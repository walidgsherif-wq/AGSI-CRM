import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

/**
 * Server-side Supabase client bound to the current request's auth cookie.
 * M1: returns a functional client but the auth session isn't wired yet —
 * calls that require auth will simply return empty results until M3.
 */
export function createSupabaseServerClient() {
  const cookieStore = cookies();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';

  return createServerClient(url, anon, {
    cookies: {
      get(name: string) {
        return cookieStore.get(name)?.value;
      },
      set() {
        // Read-only in Server Components. The auth callback route handles set/remove.
      },
      remove() {
        // Read-only in Server Components.
      },
    },
  });
}

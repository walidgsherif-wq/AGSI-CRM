import { createBrowserClient } from '@supabase/ssr';

/**
 * Browser-side Supabase client. Use in Client Components.
 * M1: lazily instantiated; safe to import before env is populated.
 */
export function createSupabaseBrowserClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';
  return createBrowserClient(url, anon);
}

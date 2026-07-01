import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { serverComponentCookies } from '@/lib/supabase/cookie-adapter';

/**
 * Read the CRM setup-mode flag from prod. Uses the SECURITY DEFINER
 * `crm_setup_mode()` helper (0085) so bd_manager sessions can read it
 * too — the raw app_settings row is whitelisted RLS-out for them.
 *
 * Never throws. If the RPC is unreachable (RLS blip / cold start),
 * treats setup mode as OFF — safer default when unsure.
 */
export async function getCrmSetupMode(): Promise<boolean> {
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
    { cookies: serverComponentCookies(cookies()) },
  );
  const { data } = await supabase.rpc('crm_setup_mode');
  return data === true;
}

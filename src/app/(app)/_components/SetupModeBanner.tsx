import { getCrmSetupMode } from '@/lib/setup-mode';

/**
 * Persistent app-wide banner rendered above the main content whenever
 * CRM setup mode is on. Prevents "silently left on" — every page in
 * the authenticated shell carries the warning until admin flips it
 * off in Admin → Settings.
 *
 * Server component: reads the flag once per request via crm_setup_mode()
 * (SECURITY DEFINER helper). If the flag is off, renders nothing.
 */
export async function SetupModeBanner() {
  const on = await getCrmSetupMode();
  if (!on) return null;
  return (
    <div className="border-b border-rag-amber/40 bg-rag-amber/10 px-4 py-2 text-xs font-medium text-rag-amber sm:px-6 lg:px-8">
      <span className="mr-2 rounded-full bg-rag-amber/20 px-2 py-0.5 text-xxs uppercase tracking-wide">
        Setup mode
      </span>
      Level gates relaxed for initial backfill. Owners can set the current
      level of their stakeholders directly (emirate + work-email contact
      still required). Turn off in Admin &rarr; Settings when backfill is done.
    </div>
  );
}

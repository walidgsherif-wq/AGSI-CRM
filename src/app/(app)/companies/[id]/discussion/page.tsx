import { redirect } from 'next/navigation';

/**
 * The Discussion moved from a tab into the persistent right rail
 * on the company detail page. Every mention notification created
 * by post_company_comment (0094) points here with `?comment=<id>`,
 * and we don't touch the RPC — so this route stays alive as a
 * redirect that preserves the query string. Landing on the parent
 * URL lets the always-visible rail pick up `?comment=<id>` from
 * useSearchParams and scroll + highlight the target.
 */
export const dynamic = 'force-dynamic';

export default function CompanyDiscussionRedirect({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(searchParams)) {
    if (typeof v === 'string') qs.set(k, v);
    else if (Array.isArray(v)) v.forEach((vv) => qs.append(k, vv));
  }
  const suffix = qs.toString();
  redirect(`/companies/${params.id}${suffix ? `?${suffix}` : ''}`);
}

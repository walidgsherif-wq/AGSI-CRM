import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { serverComponentCookies } from '@/lib/supabase/cookie-adapter';
import { getCurrentUser } from '@/lib/auth/get-user';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { CompanyForm, type ProfileOption } from '../_components/CompanyForm';

export const dynamic = 'force-dynamic';

export default async function NewCompanyPage() {
  const user = await getCurrentUser();
  if (user.role === 'leadership') notFound();

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
    { cookies: serverComponentCookies(cookies()) },
  );

  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, full_name, role')
    .eq('is_active', true)
    .order('full_name')
    .returns<ProfileOption[]>();

  return (
    <div className="space-y-6">
      <div>
        <Link href="/companies" className="text-xs text-agsi-darkGray hover:underline">
          ← Companies
        </Link>
        <h1 className="mt-1 text-2xl font-semibold text-agsi-navy">New company</h1>
        <p className="mt-1 text-sm text-agsi-darkGray">
          Manual entry. The BNC pipeline (M5) will create companies automatically from uploads.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Details</CardTitle>
          <CardDescription>
            Required: name, type. Everything else can be filled in later.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <CompanyForm mode="create" profiles={profiles ?? []} editable />
        </CardContent>
      </Card>
    </div>
  );
}

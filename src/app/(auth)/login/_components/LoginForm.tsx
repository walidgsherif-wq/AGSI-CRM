'use client';

import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';

function friendlyError(code?: string): string {
  if (!code) return '';
  switch (code) {
    case 'profile_missing':
      return 'No AGSI account found for that email. Contact your administrator — access is invite-only.';
    case 'account_deactivated':
      return 'This account has been deactivated. Contact your administrator.';
    case 'missing_code':
      return 'Sign-in was interrupted. Try again.';
    default:
      return decodeURIComponent(code);
  }
}

export function LoginForm({ error, next }: { error?: string; next: string }) {
  const [googleSending, setGoogleSending] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [dismissedError, setDismissedError] = useState(false);

  const showProfileMissing = !dismissedError && error === 'profile_missing';
  const showDeactivated = !dismissedError && error === 'account_deactivated';

  if (showProfileMissing || showDeactivated) {
    const title = showProfileMissing
      ? 'Your user profile is not registered'
      : 'Your account has been deactivated';
    const body = showProfileMissing
      ? 'Please contact your administrator to request access. AGSI CRM is invite-only — once your administrator adds your Google email, you can sign in here.'
      : 'Please contact your administrator if you believe this is a mistake.';
    return (
      <Card>
        <CardHeader>
          <Badge variant="red" className="w-fit">
            Access denied
          </Badge>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{body}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            type="button"
            onClick={() => setDismissedError(true)}
            className="w-full"
          >
            Back to sign in
          </Button>
        </CardContent>
      </Card>
    );
  }

  async function onGoogle() {
    setGoogleSending(true);
    setLocalError(null);
    const supabase = createSupabaseBrowserClient();
    const origin = window.location.origin;
    // Strangers with a Google account *can* OAuth — Supabase has no way
    // to refuse the handshake without a pre-existing user row. The
    // invite-only gate runs after: 0055 trigger does NOT create a
    // profile for non-bootstrap inserts; auth/callback signs them out
    // and redirects to /login?error=profile_missing.
    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${origin}/auth/callback?next=${encodeURIComponent(next)}`,
      },
    });
    if (oauthError) {
      setGoogleSending(false);
      setLocalError(oauthError.message);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sign in</CardTitle>
        <CardDescription>
          Continue with your AGSI Google account. Access is invite-only.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button
          type="button"
          onClick={onGoogle}
          disabled={googleSending}
          variant="outline"
          className="w-full"
        >
          {googleSending ? 'Redirecting…' : 'Continue with Google'}
        </Button>

        {(localError || (!dismissedError && error)) && (
          <p className="mt-3 text-xs text-rag-red">
            {localError ?? friendlyError(error)}
          </p>
        )}

        <p className="mt-6 text-xs text-agsi-darkGray">
          Don&apos;t have an AGSI account? Contact your administrator — access is invite-only.
        </p>
      </CardContent>
    </Card>
  );
}

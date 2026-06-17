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
        <CardHeader className="items-center text-center">
          <Badge variant="red" className="w-fit">
            Access denied
          </Badge>
          <CardTitle className="text-xl">{title}</CardTitle>
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
      <CardHeader className="items-center text-center">
        <CardTitle className="text-xl">Welcome to AGSI CRM</CardTitle>
        <CardDescription>
          Sign in with your AGSI Google account. Access is invite-only.
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
          <GoogleIcon className="h-4 w-4" />
          {googleSending ? 'Redirecting…' : 'Continue with Google'}
        </Button>

        {(localError || (!dismissedError && error)) && (
          <p className="mt-3 text-center text-xs text-rag-red">
            {localError ?? friendlyError(error)}
          </p>
        )}

        <p className="mt-6 text-center text-xs text-agsi-darkGray">
          Don&apos;t have an AGSI account? Contact your administrator — access is invite-only.
        </p>
      </CardContent>
    </Card>
  );
}

function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 48 48"
      aria-hidden
      className={className}
    >
      <path
        fill="#FFC107"
        d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z"
      />
      <path
        fill="#FF3D00"
        d="m6.306 14.691 6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z"
      />
      <path
        fill="#4CAF50"
        d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238A11.91 11.91 0 0 1 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z"
      />
      <path
        fill="#1976D2"
        d="M43.611 20.083H42V20H24v8h11.303a12.04 12.04 0 0 1-4.087 5.571l.003-.002 6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z"
      />
    </svg>
  );
}

'use client';

import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';

export function LoginForm({ error, next }: { error?: string; next: string }) {
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [googleSending, setGoogleSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [showMagicLink, setShowMagicLink] = useState(false);

  async function onGoogle() {
    setGoogleSending(true);
    setLocalError(null);
    const supabase = createSupabaseBrowserClient();
    const origin = window.location.origin;
    // Strangers with a Google account *can* OAuth — Supabase has no way
    // to refuse the handshake without a pre-existing user row. The
    // invite-only gate runs after: 0055 trigger does NOT create a
    // profile for non-bootstrap inserts, and get-user.ts redirects
    // sessions with no profile to /login?error=profile_missing.
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
    // On success the browser is already navigating to Google — no
    // state to clear.
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSending(true);
    setLocalError(null);
    const supabase = createSupabaseBrowserClient();
    const origin = window.location.origin;
    const { error: otpError } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${origin}/auth/callback?next=${encodeURIComponent(next)}`,
        // Invite-only: never create a new auth.users row from the
        // login form. config.toml has enable_signup = false; this
        // honours that at the client too. An uninvited email lands
        // on the friendly message below.
        shouldCreateUser: false,
      },
    });
    setSending(false);
    if (otpError) {
      const m = (otpError.message ?? '').toLowerCase();
      const isUnknownUser =
        m.includes('signups not allowed') ||
        m.includes('user not found') ||
        m.includes('invalid login credentials');
      setLocalError(
        isUnknownUser
          ? 'No AGSI account found for that email. Contact your administrator — access is invite-only.'
          : otpError.message,
      );
    } else {
      setSent(true);
    }
  }

  if (sent) {
    return (
      <Card>
        <CardHeader>
          <Badge variant="green" className="w-fit">
            Link sent
          </Badge>
          <CardTitle>Check your inbox</CardTitle>
          <CardDescription>
            We sent a sign-in link to <strong>{email}</strong>. Click the link to sign in. The
            link expires in 1 hour.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-agsi-darkGray">
            Didn&apos;t get it? Check your spam folder. Still nothing after 2 minutes, click
            below to request a new link.
          </p>
          <button
            onClick={() => setSent(false)}
            className="mt-3 text-xs font-medium text-agsi-accent hover:underline"
          >
            Send again
          </button>
        </CardContent>
      </Card>
    );
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

        {(error || localError) && (
          <p className="mt-3 text-xs text-rag-red">
            {localError ?? decodeURIComponent(error ?? '')}
          </p>
        )}

        <div className="mt-6 border-t border-agsi-lightGray pt-4">
          {!showMagicLink ? (
            <button
              type="button"
              onClick={() => setShowMagicLink(true)}
              className="text-xs font-medium text-agsi-accent hover:underline"
            >
              Sign in with email link instead
            </button>
          ) : (
            <form onSubmit={onSubmit} className="space-y-4">
              <div>
                <label
                  htmlFor="email"
                  className="block text-xs font-medium text-agsi-darkGray"
                >
                  Email address
                </label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@agsi.ae"
                  className="mt-1 w-full rounded-lg border border-agsi-midGray bg-white px-3 py-2 text-sm text-agsi-navy placeholder:text-agsi-midGray focus:border-agsi-accent focus:outline-none focus:ring-1 focus:ring-agsi-accent"
                />
              </div>

              <Button type="submit" disabled={sending || !email} className="w-full">
                {sending ? 'Sending…' : 'Send sign-in link'}
              </Button>
            </form>
          )}
        </div>

        <p className="mt-4 text-xs text-agsi-darkGray">
          Don&apos;t have an AGSI account? Contact your administrator — access is invite-only.
        </p>
      </CardContent>
    </Card>
  );
}

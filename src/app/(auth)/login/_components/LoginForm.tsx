'use client';

import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';

export function LoginForm({ error, next }: { error?: string; next: string }) {
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

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
        shouldCreateUser: true,
      },
    });
    setSending(false);
    if (otpError) {
      setLocalError(otpError.message);
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
          Enter your AGSI email. We&apos;ll send you a one-click sign-in link.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label htmlFor="email" className="block text-xs font-medium text-agsi-darkGray">
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

          {(error || localError) && (
            <p className="text-xs text-rag-red">
              {localError ?? decodeURIComponent(error ?? '')}
            </p>
          )}

          <Button type="submit" disabled={sending || !email} className="w-full">
            {sending ? 'Sending…' : 'Send sign-in link'}
          </Button>
        </form>

        <p className="mt-4 text-xs text-agsi-darkGray">
          Don&apos;t have an AGSI account? Contact your administrator — access is invite-only.
        </p>
      </CardContent>
    </Card>
  );
}

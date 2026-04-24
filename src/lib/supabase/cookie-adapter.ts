import type { CookieOptions } from '@supabase/ssr';
import type { ReadonlyRequestCookies } from 'next/dist/server/web/spec-extension/adapters/request-cookies';
import type { NextRequest, NextResponse } from 'next/server';

/**
 * Cookie adapter for @supabase/ssr in Server Components (read-only).
 * Pass the result of `cookies()` from 'next/headers'.
 */
export function serverComponentCookies(store: ReadonlyRequestCookies) {
  return {
    get(name: string) {
      return store.get(name)?.value;
    },
    set(_name: string, _value: string, _options: CookieOptions) {
      // no-op: read-only in Server Components
    },
    remove(_name: string, _options: CookieOptions) {
      // no-op
    },
  };
}

/**
 * Cookie adapter for route handlers / server actions where writes are allowed.
 */
export function mutableCookies(store: {
  get(name: string): { value: string } | undefined;
  set(input: { name: string; value: string } & CookieOptions): void;
}) {
  return {
    get(name: string) {
      return store.get(name)?.value;
    },
    set(name: string, value: string, options: CookieOptions) {
      store.set({ name, value, ...options });
    },
    remove(name: string, options: CookieOptions) {
      store.set({ name, value: '', ...options });
    },
  };
}

/**
 * Cookie adapter for middleware. Writes land on the outgoing NextResponse.
 */
export function middlewareCookies(req: NextRequest, res: NextResponse) {
  return {
    get(name: string) {
      return req.cookies.get(name)?.value;
    },
    set(name: string, value: string, options: CookieOptions) {
      res.cookies.set({ name, value, ...options });
    },
    remove(name: string, options: CookieOptions) {
      res.cookies.set({ name, value: '', ...options });
    },
  };
}

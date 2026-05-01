'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { Menu } from 'lucide-react';
import { Sidebar } from '@/components/domain/Sidebar';
import type { Role } from '@/types/domain';

type Props = {
  user: { role: Role; fullName: string; email: string };
  children: React.ReactNode;
};

/**
 * AppShell — client wrapper around the authenticated layout. Owns the
 * mobile-menu open/close state. Above lg breakpoint (≥1024px) the
 * sidebar is always visible; below it the sidebar slides in as a fixed
 * overlay triggered by the top-bar hamburger. Backdrop click + ESC +
 * route change all close the menu.
 */
export function AppShell({ user, children }: Props) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  // Lock body scroll while overlay is open on mobile
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  return (
    <div className="flex min-h-screen bg-agsi-offWhite">
      <Sidebar
        role={user.role}
        fullName={user.fullName}
        email={user.email}
        isMobileOpen={open}
        onMobileClose={() => setOpen(false)}
      />

      {open && (
        <button
          type="button"
          aria-label="Close menu"
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-30 bg-agsi-navy/40 backdrop-blur-sm lg:hidden"
        />
      )}

      <div className="flex flex-1 flex-col overflow-x-hidden">
        <div className="flex items-center justify-between border-b border-agsi-lightGray bg-white px-4 py-3 lg:hidden">
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label="Open menu"
            className="flex h-9 w-9 items-center justify-center rounded-lg text-agsi-navy hover:bg-agsi-offWhite"
          >
            <Menu className="h-5 w-5" aria-hidden />
          </button>
          <div className="flex items-center gap-2">
            <div
              aria-hidden
              className="flex h-7 w-7 items-center justify-center rounded-md bg-agsi-navy text-xs font-bold text-white"
            >
              AG
            </div>
            <span className="text-sm font-semibold text-agsi-navy">AGSI CRM</span>
          </div>
          <span aria-hidden className="h-9 w-9" />
        </div>

        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          {children}
        </main>
      </div>
    </div>
  );
}

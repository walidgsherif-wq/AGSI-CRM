import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';

const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter',
});

export const metadata: Metadata = {
  title: 'AGSI CRM',
  description: 'AGSI Business Development CRM',
  // No `icons` here — Next.js auto-generates the favicon <link> from
  // src/app/icon.png (file-convention). Overriding this metadata field
  // shadows the file convention and points at a file that isn't shipped.
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body>{children}</body>
    </html>
  );
}

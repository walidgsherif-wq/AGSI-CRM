import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-agsi-offWhite px-6">
      <div className="w-full max-w-md rounded-lg bg-white p-8 text-center shadow-card">
        <p className="text-sm font-medium uppercase tracking-wider text-agsi-darkGray">404</p>
        <h1 className="mt-2 text-2xl font-semibold text-agsi-navy">Page not found</h1>
        <p className="mt-3 text-sm text-agsi-darkGray">
          The page you are looking for doesn&apos;t exist or has been moved.
        </p>
        <Link
          href="/dashboard"
          className="mt-6 inline-flex items-center rounded-lg bg-agsi-navy px-4 py-2 text-sm font-medium text-white hover:bg-agsi-blue"
        >
          Back to dashboard
        </Link>
      </div>
    </main>
  );
}

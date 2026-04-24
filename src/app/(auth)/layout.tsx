export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-agsi-offWhite px-6">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center gap-3">
          <div
            aria-hidden
            className="flex h-10 w-10 items-center justify-center rounded-lg bg-agsi-navy text-sm font-bold text-white"
          >
            AG
          </div>
          <div>
            <h1 className="text-base font-semibold text-agsi-navy">AGSI CRM</h1>
            <p className="text-xs text-agsi-darkGray">Business Development</p>
          </div>
        </div>
        {children}
      </div>
    </main>
  );
}

import Image from 'next/image';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-agsi-offWhite px-6 py-10">
      <div className="w-full max-w-md">
        <div className="mb-8 flex flex-col items-center text-center">
          <Image
            src="/agsi-logo.png"
            alt="AGSI"
            width={1819}
            height={723}
            priority
            className="h-auto w-56"
          />
          <p className="mt-3 text-xs text-agsi-darkGray">Business Development CRM</p>
        </div>
        {children}
      </div>
    </main>
  );
}

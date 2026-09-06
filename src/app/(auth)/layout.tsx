import Link from "next/link";
import type { ReactNode } from "react";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-sand-50 px-4 py-8 sm:py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center sm:mb-8">
          <Link href="/" className="font-display text-2xl font-semibold tracking-tight text-brand-800 sm:text-3xl">
            Elite Academy
          </Link>
          <p className="mt-2 text-sm text-slate-500">
            La plateforme de formation professionnelle d&apos;Elite Experience
          </p>
        </div>
        {children}
        <p className="mt-6 text-center text-sm">
          <Link href="/" className="text-slate-500 transition hover:text-brand-700">
            ← Retour à l&apos;accueil
          </Link>
        </p>
      </div>
    </main>
  );
}

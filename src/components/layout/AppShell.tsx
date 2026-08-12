"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { MemberRole, NavItem } from "@/lib/auth/roles";
import { ROLE_LABELS } from "@/lib/auth/roles";

/**
 * Shell applicatif responsive.
 *
 * Points de rupture documentés :
 * - < 1024 px (mobile / tablette) : barre supérieure + menu déroulant,
 *   contenu sur une colonne, boutons d'au moins 44 px de hauteur ;
 * - >= 1024 px (lg, ordinateur)   : barre latérale fixe de 256 px +
 *   zone de contenu large pour tableaux et colonnes côte à côte.
 *
 * Ce composant ne contient aucune logique métier : il reçoit la
 * navigation déjà calculée selon le rôle (src/lib/auth/roles.ts).
 */
export function AppShell({
  nav,
  role,
  userName,
  onSignOut,
  children,
}: {
  nav: NavItem[];
  role: MemberRole;
  userName: string;
  onSignOut: () => Promise<void>;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [menuOuvert, setMenuOuvert] = useState(false);

  const estActif = (href: string) =>
    pathname === href || pathname.startsWith(`${href}/`);

  const liens = (
    <ul className="space-y-1">
      {nav.map((item) => (
        <li key={item.href}>
          <Link
            href={item.href}
            onClick={() => setMenuOuvert(false)}
            aria-current={estActif(item.href) ? "page" : undefined}
            className={`block rounded-lg px-3 py-2.5 text-sm font-medium transition ${
              estActif(item.href)
                ? "bg-brand-600 text-white"
                : "text-slate-700 hover:bg-slate-100"
            }`}
          >
            {item.label}
          </Link>
        </li>
      ))}
    </ul>
  );

  const blocUtilisateur = (
    <div className="border-t border-slate-200 pt-4">
      <p className="truncate text-sm font-medium text-slate-900">{userName}</p>
      <p className="text-xs text-slate-500">{ROLE_LABELS[role]}</p>
      <form action={onSignOut} className="mt-3">
        <button
          type="submit"
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
        >
          Se déconnecter
        </button>
      </form>
    </div>
  );

  return (
    <div className="min-h-screen lg:flex">
      {/* Barre latérale – ordinateur */}
      <aside className="hidden w-64 shrink-0 border-r border-slate-200 bg-white lg:flex lg:flex-col">
        <div className="px-4 py-5">
          <Link href="/accueil" className="font-display text-xl font-semibold tracking-tight text-brand-800">
            Elite Academy
          </Link>
        </div>
        <nav aria-label="Navigation principale" className="flex-1 px-3">
          {liens}
        </nav>
        <div className="px-4 pb-5">{blocUtilisateur}</div>
      </aside>

      {/* Barre supérieure – mobile et tablette */}
      <div className="flex flex-1 flex-col">
        <header className="sticky top-0 z-20 flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3 lg:hidden">
          <Link href="/accueil" className="font-display text-xl font-semibold tracking-tight text-brand-800">
            Elite Academy
          </Link>
          <button
            type="button"
            onClick={() => setMenuOuvert((v) => !v)}
            aria-expanded={menuOuvert}
            aria-controls="menu-mobile"
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700"
          >
            {menuOuvert ? "Fermer" : "Menu"}
          </button>
        </header>

        {menuOuvert ? (
          <nav
            id="menu-mobile"
            aria-label="Navigation principale"
            className="border-b border-slate-200 bg-white px-3 py-3 lg:hidden"
          >
            {liens}
            <div className="mt-4">{blocUtilisateur}</div>
          </nav>
        ) : null}

        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 lg:px-8">
          {children}
        </main>
      </div>
    </div>
  );
}

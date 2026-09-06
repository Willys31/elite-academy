"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { MemberRole, NavItem } from "@/lib/auth/roles";
import { ROLE_LABELS } from "@/lib/auth/roles";

/**
 * Shell applicatif responsive.
 *
 * Points de rupture documentés :
 * - < 1024 px (mobile / tablette) : barre supérieure collante + tiroir
 *   de navigation glissant par-dessus le contenu (voile de fond,
 *   fermeture au clic extérieur, à la touche Échap et au changement de
 *   page, défilement du fond bloqué), contenu sur une colonne,
 *   cibles tactiles d'au moins 44 px ;
 * - >= 1024 px (lg, ordinateur)   : barre latérale fixe de 256 px,
 *   elle-même défilante si la navigation dépasse la hauteur d'écran +
 *   zone de contenu large pour tableaux et colonnes côte à côte.
 *
 * Le tiroir est préféré au menu déroulant : il ne pousse pas le contenu
 * vers le bas, garde la page en place et reste utilisable quand la
 * navigation compte beaucoup d'entrées.
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
  const tiroirRef = useRef<HTMLDivElement>(null);
  const boutonRef = useRef<HTMLButtonElement>(null);

  const fermer = useCallback(() => setMenuOuvert(false), []);

  // Le changement de page ferme le tiroir : le lien cliqué n'a pas à
  // s'en charger lui-même, et un retour navigateur ne le laisse pas ouvert.
  useEffect(() => {
    setMenuOuvert(false);
  }, [pathname]);

  // Tiroir ouvert : Échap ferme, le fond ne défile plus, le focus entre
  // dans le tiroir puis revient sur le bouton à la fermeture.
  useEffect(() => {
    if (!menuOuvert) return;

    const surTouche = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMenuOuvert(false);
        boutonRef.current?.focus();
      }
    };
    document.addEventListener("keydown", surTouche);

    const overflowInitial = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    tiroirRef.current?.focus();

    return () => {
      document.removeEventListener("keydown", surTouche);
      document.body.style.overflow = overflowInitial;
    };
  }, [menuOuvert]);

  const estActif = (href: string) =>
    pathname === href || pathname.startsWith(`${href}/`);

  const liens = (
    <ul className="space-y-1">
      {nav.map((item) => (
        <li key={item.href}>
          <Link
            href={item.href}
            onClick={fermer}
            aria-current={estActif(item.href) ? "page" : undefined}
            className={`flex min-h-11 items-center rounded-lg px-3 py-2.5 text-[15px] font-medium transition lg:text-sm ${
              estActif(item.href)
                ? "bg-brand-600 text-white"
                : "text-slate-700 hover:bg-slate-100 active:bg-slate-100"
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
          className="min-h-11 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
        >
          Se déconnecter
        </button>
      </form>
    </div>
  );

  return (
    <div className="min-h-dvh lg:flex">
      {/* Barre latérale – ordinateur (collante et défilante indépendamment) */}
      <aside className="hidden w-64 shrink-0 border-r border-slate-200 bg-white lg:sticky lg:top-0 lg:flex lg:h-dvh lg:flex-col">
        <div className="px-4 py-5">
          <Link
            href="/accueil"
            className="font-display text-xl font-semibold tracking-tight text-brand-800"
          >
            Elite Academy
          </Link>
        </div>
        <nav
          aria-label="Navigation principale"
          className="flex-1 overflow-y-auto px-3"
        >
          {liens}
        </nav>
        <div className="px-4 pb-5">{blocUtilisateur}</div>
      </aside>

      {/* Colonne principale – mobile et tablette */}
      {/* `min-w-0` est indispensable : sans lui, un enfant large (tableau,
          bloc de code) élargit la colonne flex au lieu de défiler. */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-slate-200 bg-white/95 px-4 py-3 backdrop-blur pt-[max(0.75rem,env(safe-area-inset-top))] lg:hidden">
          <Link
            href="/accueil"
            className="truncate font-display text-lg font-semibold tracking-tight text-brand-800 sm:text-xl"
          >
            Elite Academy
          </Link>
          <button
            ref={boutonRef}
            type="button"
            onClick={() => setMenuOuvert((v) => !v)}
            aria-expanded={menuOuvert}
            aria-controls="menu-mobile"
            aria-label={menuOuvert ? "Fermer le menu" : "Ouvrir le menu"}
            className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
          >
            <span aria-hidden className="flex w-4 flex-col gap-[3px]">
              <span className="h-0.5 w-full rounded bg-slate-700" />
              <span className="h-0.5 w-full rounded bg-slate-700" />
              <span className="h-0.5 w-full rounded bg-slate-700" />
            </span>
            Menu
          </button>
        </header>

        {/* Voile de fond : ferme le tiroir au clic hors navigation. */}
        <div
          onClick={fermer}
          aria-hidden
          className={`fixed inset-0 z-40 bg-slate-900/40 transition-opacity duration-200 lg:hidden ${
            menuOuvert
              ? "opacity-100"
              : "pointer-events-none opacity-0"
          }`}
        />

        {/* Tiroir de navigation – glisse depuis la gauche */}
        <div
          ref={tiroirRef}
          id="menu-mobile"
          role="dialog"
          aria-modal="true"
          aria-label="Navigation principale"
          tabIndex={-1}
          inert={menuOuvert ? undefined : true}
          className={`fixed inset-y-0 left-0 z-50 flex w-[min(20rem,85vw)] flex-col border-r border-slate-200 bg-white shadow-xl outline-none transition-transform duration-200 ease-out motion-reduce:transition-none lg:hidden ${
            menuOuvert ? "translate-x-0" : "-translate-x-full"
          }`}
        >
          <div className="flex items-center justify-between gap-2 px-4 py-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
            <span className="font-display text-lg font-semibold tracking-tight text-brand-800">
              Elite Academy
            </span>
            <button
              type="button"
              onClick={() => {
                fermer();
                boutonRef.current?.focus();
              }}
              className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-slate-300 text-slate-700 transition hover:bg-slate-50"
              aria-label="Fermer le menu"
            >
              <span aria-hidden className="text-lg leading-none">
                ×
              </span>
            </button>
          </div>
          <nav
            aria-label="Navigation principale"
            className="flex-1 overflow-y-auto overscroll-contain px-3 py-2"
          >
            {liens}
          </nav>
          <div className="px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
            {blocUtilisateur}
          </div>
        </div>

        <main className="mx-auto w-full min-w-0 max-w-6xl flex-1 px-4 py-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:px-6 lg:px-8 lg:py-8">
          {children}
        </main>
      </div>
    </div>
  );
}

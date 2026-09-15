"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { MemberRole, NavItem } from "@/lib/auth/roles";
import { ROLE_LABELS } from "@/lib/auth/roles";
import { useSuiviNavigation } from "@/lib/nav/historique";
import { Icone, iconePourLien } from "@/components/icons";
import { Marque } from "@/components/Marque";

/** « Awa Koné » → « AK » ; une adresse e-mail donne sa première lettre. */
function initiales(nom: string): string {
  const mots = nom.includes("@") ? [nom] : nom.trim().split(/\s+/);
  return mots
    .slice(0, 2)
    .map((m) => m.charAt(0).toUpperCase())
    .join("");
}

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
 * Habillage : barre latérale claire à filet, une icône par rubrique pour
 * se repérer d'un coup d'œil, entrée active sur fond vert pâle. Le
 * contenu reste la seule surface qui attire l'œil.
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

  // Compte les pages vues dans l'onglet : c'est ce qui permet au bouton
  // « Retour » de ramener là d'où l'on vient plutôt que vers un parent
  // théorique, sans risquer de faire sortir du site.
  useSuiviNavigation();

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
    <ul className="space-y-0.5">
      {nav.map((item) => {
        const actif = estActif(item.href);
        return (
          <li key={item.href}>
            <Link
              href={item.href}
              onClick={fermer}
              aria-current={actif ? "page" : undefined}
              className={`group flex min-h-11 items-center gap-3 rounded-lg px-3 py-2 text-[15px] font-medium transition-colors duration-150 lg:min-h-10 lg:text-sm ${
                actif
                  ? "bg-brand-50 text-brand-800"
                  : "text-slate-600 hover:bg-sand-100 hover:text-ink-900"
              }`}
            >
              <Icone
                nom={iconePourLien(item.href)}
                className={`size-[18px] shrink-0 transition-colors duration-150 ${
                  actif ? "text-brand-700" : "text-slate-400 group-hover:text-slate-600"
                }`}
              />
              <span className="truncate">{item.label}</span>
            </Link>
          </li>
        );
      })}
    </ul>
  );

  const blocUtilisateur = (
    <div className="flex items-center gap-3 rounded-xl border border-sand-200 bg-sand-50 p-2 pl-2.5">
      <span
        aria-hidden
        className="flex size-9 shrink-0 items-center justify-center rounded-full bg-brand-100 text-[13px] font-semibold text-brand-800"
      >
        {initiales(userName)}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-ink-900">{userName}</p>
        <p className="truncate text-xs text-slate-500">{ROLE_LABELS[role]}</p>
      </div>
      <form action={onSignOut}>
        <button
          type="submit"
          aria-label="Se déconnecter"
          title="Se déconnecter"
          className="inline-flex size-11 items-center justify-center rounded-lg text-slate-500 transition-colors duration-150 hover:bg-white hover:text-ink-900 lg:size-9"
        >
          <Icone nom="deconnexion" className="size-[18px]" />
        </button>
      </form>
    </div>
  );

  return (
    <div className="min-h-dvh bg-sand-50 lg:flex">
      {/* Barre latérale – ordinateur (collante et défilante indépendamment) */}
      <aside className="hidden w-64 shrink-0 border-r border-sand-200 bg-white lg:sticky lg:top-0 lg:flex lg:h-dvh lg:flex-col">
        <div className="flex h-16 items-center px-5">
          <Link
            href="/accueil"
            className="rounded-lg transition-opacity duration-150 hover:opacity-80"
          >
            <Marque />
          </Link>
        </div>
        <nav aria-label="Navigation principale" className="flex-1 overflow-y-auto px-3 py-3">
          {liens}
        </nav>
        <div className="p-3">{blocUtilisateur}</div>
      </aside>

      {/* Colonne principale – mobile et tablette */}
      {/* `min-w-0` est indispensable : sans lui, un enfant large (tableau,
          bloc de code) élargit la colonne flex au lieu de défiler. */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-sand-200 bg-white/90 px-4 py-2.5 pt-[max(0.625rem,env(safe-area-inset-top))] backdrop-blur-md lg:hidden">
          <Link href="/accueil" className="min-w-0 rounded-lg">
            <Marque />
          </Link>
          <button
            ref={boutonRef}
            type="button"
            onClick={() => setMenuOuvert((v) => !v)}
            aria-expanded={menuOuvert}
            aria-controls="menu-mobile"
            aria-label={menuOuvert ? "Fermer le menu" : "Ouvrir le menu"}
            className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-lg border border-sand-300 bg-white px-3 py-2 text-sm font-medium text-ink-900 shadow-[0_1px_2px_rgba(17,20,18,0.05)] transition-colors duration-150 hover:bg-sand-50"
          >
            <Icone nom="menu" className="size-[18px]" />
            Menu
          </button>
        </header>

        {/* Voile de fond : ferme le tiroir au clic hors navigation. */}
        <div
          onClick={fermer}
          aria-hidden
          className={`fixed inset-0 z-40 bg-ink-950/40 transition-opacity duration-200 lg:hidden ${
            menuOuvert ? "opacity-100" : "pointer-events-none opacity-0"
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
          className={`fixed inset-y-0 left-0 z-50 flex w-[min(20rem,85vw)] flex-col bg-white shadow-2xl outline-none transition-transform duration-200 ease-out motion-reduce:transition-none lg:hidden ${
            menuOuvert ? "translate-x-0" : "-translate-x-full"
          }`}
        >
          <div className="flex items-center justify-between gap-2 border-b border-sand-200 px-4 py-2.5 pt-[max(0.625rem,env(safe-area-inset-top))]">
            <Marque />
            <button
              type="button"
              onClick={() => {
                fermer();
                boutonRef.current?.focus();
              }}
              className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg text-slate-500 transition-colors duration-150 hover:bg-sand-100 hover:text-ink-900"
              aria-label="Fermer le menu"
            >
              <Icone nom="fermer" className="size-5" />
            </button>
          </div>
          <nav
            aria-label="Navigation principale"
            className="flex-1 overflow-y-auto overscroll-contain px-3 py-3"
          >
            {liens}
          </nav>
          <div className="p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            {blocUtilisateur}
          </div>
        </div>

        <main className="mx-auto w-full min-w-0 max-w-6xl flex-1 px-4 py-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:px-6 lg:px-10 lg:py-10">
          {children}
        </main>
      </div>
    </div>
  );
}

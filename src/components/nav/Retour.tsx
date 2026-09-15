"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { MouseEvent } from "react";
import { retourResteDansLApp } from "@/lib/nav/historique";

/**
 * Bouton « Retour » commun à tous les écrans.
 *
 * C'est un vrai lien, pas un bouton : il expose `href`, le clic milieu
 * et « ouvrir dans un nouvel onglet » fonctionnent, et il reste utile
 * sans JavaScript. Au clic simple, quand l'onglet a déjà une page de
 * l'application derrière lui, on lui préfère `history.back()` : le
 * retour ramène là d'où l'on vient, y compris quand la même fiche est
 * accessible depuis plusieurs écrans.
 *
 * L'intitulé reste « Retour » — générique à dessein. Nommer la cible
 * (« Catalogue ») serait un mensonge dès que le retour arrière ramène
 * ailleurs. `href` désigne donc le parent hiérarchique, qui sert de
 * porte de sortie au premier chargement.
 *
 * `ton` suit les deux chartes en cours de cohabitation : « or » pour
 * les écrans repris (apprenant, formateur), « sobre » pour les écrans
 * concepteur et administrateur encore sur l'habillage d'origine.
 */
export function Retour({
  href,
  children = "Retour",
  ton = "or",
  className = "",
}: {
  href: string;
  children?: React.ReactNode;
  ton?: "or" | "sobre";
  className?: string;
}) {
  const router = useRouter();

  const auClic = (e: MouseEvent<HTMLAnchorElement>) => {
    // On ne détourne que le clic simple : les raccourcis d'ouverture
    // dans un onglet ou une fenêtre doivent garder leur sens.
    if (e.defaultPrevented) return;
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    if (!retourResteDansLApp()) return;

    e.preventDefault();
    router.back();
  };

  const couleurs =
    ton === "or"
      ? "border-ink-900/10 bg-white text-ink-900 hover:border-gold-400/60 hover:bg-sand-50"
      : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50";

  return (
    <Link
      href={href}
      onClick={auClic}
      className={`mb-4 inline-flex min-h-11 items-center gap-2 rounded-lg border px-3.5 py-2 text-sm font-medium shadow-sm transition duration-200 ${couleurs} ${className}`}
    >
      <span aria-hidden className="text-base leading-none">
        ←
      </span>
      {children}
    </Link>
  );
}

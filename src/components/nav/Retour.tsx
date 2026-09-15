"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { MouseEvent } from "react";
import { retourResteDansLApp } from "@/lib/nav/historique";
import { Icone } from "@/components/icons";

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
 * `ton` est conservé pour compatibilité : les deux chartes ont
 * fusionné, les deux valeurs rendent désormais le même lien discret.
 */
export function Retour({
  href,
  children = "Retour",
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

  return (
    <Link
      href={href}
      onClick={auClic}
      className={`group -ml-2.5 mb-3 inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2.5 py-2 text-sm font-medium text-slate-500 transition-colors duration-150 hover:bg-sand-100 hover:text-ink-900 ${className}`}
    >
      <Icone
        nom="flecheGauche"
        className="size-4 transition-transform duration-150 group-hover:-translate-x-0.5"
      />
      {children}
    </Link>
  );
}

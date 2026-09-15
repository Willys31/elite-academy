"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

/**
 * Le bouton « Retour » doit ramener l'utilisateur d'où il vient, pas
 * vers un parent théorique : une fiche formation ouverte depuis
 * « Mes formations » doit y revenir, pas atterrir sur le catalogue.
 * `history.back()` fait exactement ça — à une condition : qu'il y ait
 * bien une page de l'application derrière. Sinon (onglet neuf, lien
 * partagé, favori) il ferait sortir du site.
 *
 * Deux signaux, et deux seulement, prouvent qu'un retour arrière reste
 * dans l'application :
 *
 * 1. une navigation interne a déjà eu lieu dans CE document — le
 *    chemin affiché a changé au moins une fois sous nos yeux, donc
 *    l'entrée précédente de l'historique est une page à nous ;
 * 2. c'est la première page de ce document, mais elle a été atteinte
 *    depuis notre propre origine (`document.referrer`).
 *
 * Un compteur rangé dans `sessionStorage` avait été écarté : il
 * survit à une sortie du site dans le même onglet et laisserait alors
 * `back()` renvoyer vers la page extérieure. Les deux signaux
 * ci-dessus sont liés au document courant, donc exacts.
 */

/** Rendus du chemin observés dans ce document (1 = chargement initial). */
let cheminsObserves = 0;

/**
 * Enregistre un chemin affiché. Extrait du hook pour être exerçable
 * hors navigateur : c'est ce compteur qui décide du comportement du
 * bouton, il ne doit pas rester hors de portée des tests.
 */
export function noterChemin(): void {
  cheminsObserves += 1;
}

/** Suit les changements de page. Appelé une seule fois, par le shell. */
export function useSuiviNavigation(): void {
  const pathname = usePathname();

  useEffect(() => {
    noterChemin();
  }, [pathname]);
}

/**
 * Vrai si un retour arrière restera dans l'application.
 * À n'appeler que depuis un gestionnaire d'événement : le résultat
 * dépend du navigateur et ne doit pas participer au rendu, sous peine
 * de désaccord entre le HTML du serveur et celui du client.
 */
export function retourResteDansLApp(): boolean {
  if (cheminsObserves > 1) return true;

  try {
    const provenance = document.referrer;
    if (!provenance) return false;
    return new URL(provenance).origin === window.location.origin;
  } catch {
    return false;
  }
}

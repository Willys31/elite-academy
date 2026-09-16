/**
 * Entraide & communauté – logique pure, testable.
 *
 * Addendum Entraide : opt-in (§2), blocage de 200 caractères max (§3.1),
 * contribution de 500 caractères max sans réponse directe (§3.2), un
 * vote par personne et jamais sur sa propre aide (§3.3), +50 XP par
 * aide votée « Utile » avec un plafond de 10 par jour (Gamification
 * §3.1), badges Expert Contributor et Top Contributor (§4.1).
 */

import type { Preferences } from "@/lib/profil/preferences";

export const MIN_BLOCAGE = 10;
export const LIMITE_BLOCAGE = 200;
export const MIN_CONTRIBUTION = 20;
export const LIMITE_CONTRIBUTION = 500;
export const LIMITE_SIGNALEMENT = 300;

export type Validation = { ok: true; texte: string } | { ok: false; raison: string };

function nettoyer(texte: string): string {
  return texte.replace(/\r\n?/g, "\n").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

function valider(texte: string, min: number, max: number, quoi: string): Validation {
  const propre = nettoyer(texte);
  if (propre.length < min) {
    return { ok: false, raison: `${quoi} est trop court : ${min} caractères minimum.` };
  }
  if (propre.length > max) {
    return {
      ok: false,
      raison: `${quoi} est trop long : ${max} caractères maximum (${propre.length} saisis).`,
    };
  }
  return { ok: true, texte: propre };
}

/** « Je bloque sur [concept] car [raison] ». */
export function validerBlocage(texte: string): Validation {
  return valider(texte, MIN_BLOCAGE, LIMITE_BLOCAGE, "La description du blocage");
}

export function validerContribution(texte: string): Validation {
  return valider(texte, MIN_CONTRIBUTION, LIMITE_CONTRIBUTION, "Votre aide");
}

export function validerSignalement(texte: string): Validation {
  return valider(texte, 3, LIMITE_SIGNALEMENT, "Le motif du signalement");
}

/** L'Entraide est désactivée par défaut : l'apprenant l'active dans son profil. */
export function entraideActive(preferences: Preferences): boolean {
  return preferences.entraide.actif === true;
}

/** Les blocages sont anonymisés : jamais de nom, seulement la formation. */
export function libelleAuteurAnonyme(titreFormation: string | null | undefined): string {
  const titre = (titreFormation ?? "").trim();
  return titre ? `Un apprenant de « ${titre} »` : "Un apprenant";
}

export function peutVoter(params: { votantId: string; auteurContributionId: string }): boolean {
  return params.votantId !== params.auteurContributionId;
}

export const XP_VOTE_UTILE = 50;
export const MAX_VOTES_XP_PAR_JOUR = 10;

/** XP crédité au contributeur pour un nouveau vote, dans la limite journalière. */
export function xpPourVote(nbDejaComptesAujourdhui: number): number {
  return nbDejaComptesAujourdhui < MAX_VOTES_XP_PAR_JOUR ? XP_VOTE_UTILE : 0;
}

export const SEUILS_NOTIFICATION_VOTES = [1, 3, 5, 10, 25, 50] as const;

/** Premier seuil franchi entre deux comptes de votes, sinon null. */
export function franchitSeuil(avant: number, apres: number): number | null {
  for (const s of SEUILS_NOTIFICATION_VOTES) {
    if (avant < s && apres >= s) return s;
  }
  return null;
}

export const STATUT_BLOCAGE_LABELS: Record<string, string> = {
  open: "En attente",
  resolved: "Résolu",
  archived: "Archivé",
};

export const TON_STATUT_BLOCAGE: Record<string, "neutre" | "or" | "succes" | "alerte"> = {
  open: "or",
  resolved: "succes",
  archived: "neutre",
};

export const REGLES_CONTRIBUTION = [
  "Expliquez, donnez un indice ou une méthode — jamais la réponse directe.",
  "Restez bienveillant : un blocage n'est pas une faute.",
  "Une contribution par blocage ; soyez précis, un exemple concret aide.",
] as const;

/** Une contribution est « utile » à partir de 2 votes (Expert Contributor). */
export const VOTES_MIN_CONTRIBUTION_UTILE = 2;

/**
 * Compteurs de la famille Communauté, à partir des contributions d'un
 * apprenant et des votes reçus sur ses situations de travail (lot 16).
 */
export function compteursCommunaute(params: {
  contributions: Array<{ votes: number }>;
  votesSituations?: number;
}): { contributions_utiles: number; votes_recus: number } {
  const contributions_utiles = params.contributions.filter(
    (c) => c.votes >= VOTES_MIN_CONTRIBUTION_UTILE
  ).length;
  const votes_recus =
    params.contributions.reduce((s, c) => s + Math.max(0, c.votes), 0) +
    Math.max(0, params.votesSituations ?? 0);
  return { contributions_utiles, votes_recus };
}

export interface FiltresBlocages {
  formation?: string | null;
  competence?: string | null;
  statut?: string | null;
  portee?: string | null;
}

export function filtrerBlocages<
  T extends {
    course_id: string;
    competency_id: string | null;
    status: string;
    visibility_scope: string;
  },
>(liste: T[], filtres: FiltresBlocages): T[] {
  return liste.filter(
    (b) =>
      (!filtres.formation || b.course_id === filtres.formation) &&
      (!filtres.competence || b.competency_id === filtres.competence) &&
      (!filtres.statut || b.status === filtres.statut) &&
      (!filtres.portee || b.visibility_scope === filtres.portee)
  );
}

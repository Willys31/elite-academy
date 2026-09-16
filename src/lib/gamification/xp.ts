/**
 * Points d'expérience (XP) – logique pure, testable.
 *
 * Barème de l'addendum Gamification §3 :
 *   points_de_base       = score × coefficient_difficulté
 *   bonus_rapidité       = correct et sous le seuil de temps ? +20 à 50 % : 0
 *   multiplicateur_série = 1 + 0,1 × nb_bonnes_affilée (max 1,5)
 *   total                = (base + bonus) × multiplicateur
 *
 * Anti-triche (§3.3) : le bonus de rapidité exige un score ≥ 80 % et une
 * durée réellement mesurée ; sans mesure, pas de bonus.
 *
 * La gamification est une couche de motivation : rien ici ne touche à
 * la maîtrise par compétence (progression.ts), qui reste la seule
 * référence pour la certification.
 */

export type TypeXp =
  | "qcm"
  | "lecon_terminee"
  | "session_presence"
  | "session_ponctualite"
  | "session_activite"
  | "session_top3"
  | "session_completion"
  | "entraide_utile"
  | "situation_validee"
  | "badge"
  | "distinction"
  | "exercice_perso"
  | "deblocage"
  | "niveau_competence";

export const XP_TYPE_LABELS: Record<TypeXp, string> = {
  qcm: "QCM réussi",
  lecon_terminee: "Leçon terminée",
  session_presence: "Présence en session",
  session_ponctualite: "Ponctualité",
  session_activite: "Activité en session",
  session_top3: "Top 3 de la session",
  session_completion: "Session suivie jusqu'au bout",
  entraide_utile: "Aide votée utile",
  situation_validee: "Situation de travail validée",
  badge: "Badge débloqué",
  distinction: "Distinction reçue",
  exercice_perso: "Exercice personnalisé",
  deblocage: "Blocage surmonté",
  niveau_competence: "Niveau de compétence atteint",
};

/** Montants fixes (addendum §3.1, Sessions §4.2 et §5.3, Entraide §4.2). */
export const XP_FIXES = {
  lecon_terminee: 10,
  session_presence: 20,
  session_ponctualite: 10,
  session_activite: 10,
  session_top3: 20,
  session_completion: 50,
  entraide_utile: 50,
  situation_validee: 100,
  badge: 50,
  distinction: 100,
  niveau_competence: 100,
  deblocage: 50,
} as const;

/** Difficulté 1–5 → coefficient 10, 15, 20, 25, 30. */
export function coefDifficulte(difficulte: number): number {
  const d = Math.min(5, Math.max(1, Math.round(difficulte || 1)));
  return 10 + (d - 1) * 5;
}

export function pointsDeBase(scorePourcent: number, difficulte: number): number {
  const score = Math.min(100, Math.max(0, scorePourcent));
  return Math.round((score / 100) * coefDifficulte(difficulte));
}

/** Seuil de rapidité : 30 secondes par question. */
export function seuilRapiditeSecondes(nbQuestions: number): number {
  return Math.max(1, nbQuestions) * 30;
}

export const SCORE_MIN_RAPIDITE = 80;

/**
 * Taux de bonus (0, 0,2, 0,35 ou 0,5) selon la vitesse. Nul si le score
 * est insuffisant ou si la durée n'a pas été mesurée.
 */
export function tauxBonusRapidite(
  scorePourcent: number,
  dureeSecondes: number | null | undefined,
  seuilSecondes: number
): number {
  if (scorePourcent < SCORE_MIN_RAPIDITE) return 0;
  if (dureeSecondes === null || dureeSecondes === undefined) return 0;
  if (!Number.isFinite(dureeSecondes) || dureeSecondes <= 0) return 0;
  if (dureeSecondes <= seuilSecondes / 2) return 0.5;
  if (dureeSecondes <= seuilSecondes * 0.75) return 0.35;
  if (dureeSecondes <= seuilSecondes) return 0.2;
  return 0;
}

export const MULTIPLICATEUR_SERIE_MAX = 1.5;

export function multiplicateurSerie(nbBonnesAffilee: number): number {
  const n = Math.max(0, Math.floor(nbBonnesAffilee));
  return Math.min(MULTIPLICATEUR_SERIE_MAX, 1 + 0.1 * n);
}

export interface EntreeXpQcm {
  scorePourcent: number;
  difficulte: number;
  nbQuestions: number;
  /** Temps entre l'affichage et la soumission ; null si non mesuré. */
  dureeSecondes: number | null;
  /** Bonnes tentatives consécutives AVANT celle-ci. */
  serieAvant: number;
}

export interface DetailXpQcm {
  base: number;
  bonus: number;
  multiplicateur: number;
  total: number;
  rapiditeActivee: boolean;
}

export function calculerXpQcm(entree: EntreeXpQcm): DetailXpQcm {
  const base = pointsDeBase(entree.scorePourcent, entree.difficulte);
  const taux = tauxBonusRapidite(
    entree.scorePourcent,
    entree.dureeSecondes,
    seuilRapiditeSecondes(entree.nbQuestions)
  );
  const bonus = Math.round(base * taux);
  const multiplicateur = multiplicateurSerie(entree.serieAvant);
  return {
    base,
    bonus,
    multiplicateur,
    total: Math.round((base + bonus) * multiplicateur),
    rapiditeActivee: taux > 0,
  };
}

/** Une tentative compte comme « bonne » à partir de 80 %. */
export const SCORE_BONNE_TENTATIVE = 80;

/**
 * Longueur de la série de bonnes tentatives en fin de liste. La liste
 * est attendue de la plus ancienne à la plus récente.
 */
export function serieBonnesReponses(
  tentatives: Array<{ score: number | null }>
): number {
  let serie = 0;
  for (let i = tentatives.length - 1; i >= 0; i--) {
    const s = tentatives[i].score;
    if (s === null || s < SCORE_BONNE_TENTATIVE) break;
    serie++;
  }
  return serie;
}

/** Clé de jour UTC (YYYY-MM-DD) d'une date ISO. */
export function cleJourUtc(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return d.toISOString().slice(0, 10);
}

/**
 * Jours consécutifs d'activité jusqu'à aujourd'hui, ou jusqu'à hier
 * (la série n'est pas rompue tant que la journée n'est pas finie).
 */
export function serieJours(joursActifs: string[], aujourdhui: string): number {
  const jours = new Set(joursActifs);
  const depart = jours.has(aujourdhui) ? aujourdhui : veilleUtc(aujourdhui);
  if (!jours.has(depart)) return 0;
  let serie = 0;
  let courant = depart;
  while (jours.has(courant)) {
    serie++;
    courant = veilleUtc(courant);
  }
  return serie;
}

function veilleUtc(cle: string): string {
  const d = new Date(`${cle}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/** Paliers de série qui valent une notification et un badge. */
export const PALIERS_SERIE = [7, 30, 100, 365] as const;

export function palierSerieAtteint(avant: number, apres: number): number | null {
  for (const p of PALIERS_SERIE) {
    if (avant < p && apres >= p) return p;
  }
  return null;
}

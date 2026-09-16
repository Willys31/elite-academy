/**
 * Présence, ponctualité et départ – logique pure, testable.
 *
 * Addendum Sessions hybrides §3.3 et §4 :
 * - Présent : ≥ 80 % du temps de session ; Partiel : < 80 % ;
 * - En retard : arrivée > 5 min après le début (≤ 5 min reste
 *   acceptable et ponctuel) ; Parti en avance : départ > 10 min avant
 *   la fin ; Absent : jamais arrivé ;
 * - XP : présence 20 (ou 10 si partiel), ponctualité +10, retard
 *   pénalisant → 0 XP de présence, départ anticipé −10. Le total ne
 *   descend jamais sous 0.
 *
 * Tout est calculé à la clôture, à partir de l'heure prévue (ou de la
 * première arrivée si la session n'a pas d'heure) et de l'heure de
 * clôture réelle.
 */

export type StatutPresence = "present" | "partial" | "late" | "left_early" | "absent";
export type Ponctualite = "on_time" | "late_ok" | "late";

export const PRESENCE_LABELS: Record<StatutPresence, string> = {
  present: "Présent",
  partial: "Partiel",
  late: "En retard",
  left_early: "Parti en avance",
  absent: "Absent",
};

export const TON_PRESENCE: Record<StatutPresence, "neutre" | "or" | "succes" | "alerte"> = {
  present: "succes",
  partial: "or",
  late: "or",
  left_early: "or",
  absent: "alerte",
};

export const PONCTUALITE_LABELS: Record<Ponctualite, string> = {
  on_time: "À l'heure",
  late_ok: "Léger retard (≤ 5 min)",
  late: "Retard (> 5 min)",
};

export const SEUIL_PRESENCE = 0.8;
export const TOLERANCE_RETARD_MS = 5 * 60_000;
export const SEUIL_DEPART_ANTICIPE_MS = 10 * 60_000;

export const XP_PRESENCE = { complet: 20, partiel: 10, ponctualite: 10, penaliteDepart: -10 } as const;

export interface EntreePresence {
  /** Début prévu (ISO) ; null si la session n'a pas d'heure. */
  debutPrevu: string | null;
  /** Fin prévue (ISO) ; null si non renseignée. */
  finPrevue: string | null;
  /** Clôture réelle (ISO). */
  cloturee: string;
  /** Arrivée du participant (ISO) ; null s'il n'est jamais venu. */
  arrivee: string | null;
  /** Départ déclaré (ISO) ; null = resté jusqu'à la clôture. */
  depart: string | null;
  /** Première arrivée toutes personnes confondues, si pas d'heure prévue. */
  premiereArrivee?: string | null;
}

export interface ResultatPresence {
  statut: StatutPresence;
  ponctualite: Ponctualite;
  dureeSecondes: number;
  taux: number;
  retardSecondes: number;
  departAnticipe: boolean;
  xp: { presence: number; ponctualite: number; penalite: number; total: number };
}

const ms = (iso: string | null | undefined) => (iso ? new Date(iso).getTime() : NaN);

export function calculerPresence(e: EntreePresence): ResultatPresence {
  const cloture = ms(e.cloturee);
  const debut = Number.isFinite(ms(e.debutPrevu))
    ? ms(e.debutPrevu)
    : Number.isFinite(ms(e.premiereArrivee))
      ? ms(e.premiereArrivee)
      : Number.isFinite(ms(e.arrivee))
        ? ms(e.arrivee)
        : cloture;
  const finPrevue = ms(e.finPrevue);
  const fin = Math.min(Number.isFinite(finPrevue) ? finPrevue : cloture, cloture);
  const dureeSession = Math.max(1, fin - debut);

  if (!Number.isFinite(ms(e.arrivee))) {
    return {
      statut: "absent",
      ponctualite: "late",
      dureeSecondes: 0,
      taux: 0,
      retardSecondes: 0,
      departAnticipe: false,
      xp: { presence: 0, ponctualite: 0, penalite: 0, total: 0 },
    };
  }

  const arrivee = ms(e.arrivee);
  const depart = Number.isFinite(ms(e.depart)) ? Math.min(ms(e.depart), cloture) : cloture;
  const retardMs = Math.max(0, arrivee - debut);
  const ponctualite: Ponctualite =
    retardMs === 0 ? "on_time" : retardMs <= TOLERANCE_RETARD_MS ? "late_ok" : "late";
  const departAnticipe = fin - depart > SEUIL_DEPART_ANTICIPE_MS;

  const dureeMs = Math.max(0, Math.min(depart, fin) - Math.max(arrivee, debut));
  const taux = Math.min(1, dureeMs / dureeSession);

  let statut: StatutPresence = taux >= SEUIL_PRESENCE ? "present" : "partial";
  if (ponctualite === "late") statut = "late";
  else if (departAnticipe && taux < SEUIL_PRESENCE) statut = "left_early";

  const presence = ponctualite === "late" ? 0 : taux >= SEUIL_PRESENCE ? XP_PRESENCE.complet : XP_PRESENCE.partiel;
  const ponct = ponctualite !== "late" && taux >= SEUIL_PRESENCE ? XP_PRESENCE.ponctualite : 0;
  const penalite = departAnticipe ? XP_PRESENCE.penaliteDepart : 0;

  return {
    statut,
    ponctualite,
    dureeSecondes: Math.round(dureeMs / 1000),
    taux: Math.round(taux * 1000) / 1000,
    retardSecondes: Math.round(retardMs / 1000),
    departAnticipe,
    xp: { presence, ponctualite: ponct, penalite, total: Math.max(0, presence + ponct + penalite) },
  };
}

/** Recalcule comme si le participant était resté jusqu'à la fin (justification acceptée). */
export function presenceAvecJustification(e: EntreePresence): ResultatPresence {
  return calculerPresence({ ...e, depart: null });
}

export interface FeedbackSession {
  satisfaction_score: number | null;
  clarity_score: number | null;
  usefulness_score: number | null;
}

export function moyennesFeedback(feedbacks: FeedbackSession[]): {
  satisfaction: number | null;
  clarte: number | null;
  utilite: number | null;
  n: number;
} {
  const moy = (cle: keyof FeedbackSession) => {
    const valeurs = feedbacks.map((f) => f[cle]).filter((v): v is number => typeof v === "number");
    if (valeurs.length === 0) return null;
    return Math.round((valeurs.reduce((a, b) => a + b, 0) / valeurs.length) * 10) / 10;
  };
  return {
    satisfaction: moy("satisfaction_score"),
    clarte: moy("clarity_score"),
    utilite: moy("usefulness_score"),
    n: feedbacks.length,
  };
}

/** Part des participants ayant répondu à au moins une activité (0–100). */
export function tauxParticipation(nbRepondants: number, nbParticipants: number): number {
  if (nbParticipants <= 0) return 0;
  return Math.round((Math.min(nbRepondants, nbParticipants) / nbParticipants) * 100);
}

/** Note 1–5 lue depuis un formulaire ; null si absente ou hors bornes. */
export function lireNote(valeur: unknown): number | null {
  const n = parseInt(String(valeur ?? ""), 10);
  return Number.isInteger(n) && n >= 1 && n <= 5 ? n : null;
}

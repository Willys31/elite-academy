/**
 * Correction automatique des réponses rédigées — lot 27, revu le
 * 21/10/2026 (lot 27 bis). Logique pure, testée.
 *
 * Décision de Yakin : la correction est entièrement automatique, pour
 * toutes les réponses, sans intervention d'un formateur. Il n'y a donc
 * ni seuil de confiance, ni forçage humain par activité, ni demande de
 * relecture : chaque proposition devient la note. Un formateur garde la
 * possibilité de réviser une copie notée (`reviserTentative`) et la file
 * « Copies à corriger » ne sert plus que de repli technique quand la
 * correction automatique n'a pas abouti.
 *
 * Rien ici ne nomme le moteur : les écrans parlent de « correction
 * automatique ».
 */

import type { PropositionsCopie } from "@/lib/ai/precorrection";
import type { NoteCorrecteur } from "@/lib/courses/questions";
import type { ResultatCorrection } from "@/lib/courses/progression";

export interface ReglagesCorrectionAuto {
  /**
   * CORRECTION_AUTO : on (défaut) | off. Interrupteur d'urgence
   * uniquement : à off, les copies attendent un formateur comme au lot 26.
   */
  actif: boolean;
}

export function lireReglagesCorrectionAuto(env: (nom: string) => string): ReglagesCorrectionAuto {
  const brut = env("CORRECTION_AUTO").trim().toLowerCase();
  return { actif: !(brut === "off" || brut === "false" || brut === "0" || brut === "non") };
}

/** Commentaire de repli si le modèle n'en a pas fourni (ne devrait pas arriver : la validation l'exige). */
export const COMMENTAIRE_SANS_FEEDBACK =
  "Votre réponse ne couvre pas suffisamment les critères d'évaluation annoncés. Reprenez-les un à un et renvoyez une réponse plus complète.";

/**
 * Notes à poser automatiquement : chaque proposition devient la note.
 * « acquise » → acquise ; « non_acquise » ou « incertain » → non acquise
 * (le prompt demande de trancher ; « incertain » ne subsiste que pour
 * les données anciennes). Renvoie null seulement si une question en
 * attente n'a pas de proposition : la correction n'a pas abouti et sera
 * relancée.
 */
export function decisionAutomatique(
  propositions: PropositionsCopie,
  questionsEnAttente: string[]
): Record<string, NoteCorrecteur> | null {
  if (questionsEnAttente.length === 0) return null;
  const notes: Record<string, NoteCorrecteur> = {};
  for (const id of questionsEnAttente) {
    const p = propositions[id];
    if (!p) return null;
    notes[id] = { acquise: p.verdict === "acquise", commentaire: p.feedback_apprenant || COMMENTAIRE_SANS_FEEDBACK };
  }
  return notes;
}

/** Comment la copie a été décidée, rangé dans `attempts.feedback.decision`. */
export interface DecisionCopie {
  mode: "automatique" | "humaine";
  le: string;
  /** Révision par un formateur d'une copie déjà notée. */
  revisee_le?: string;
}

export function lireDecision(feedback: unknown): DecisionCopie | null {
  const d = (feedback as { decision?: unknown } | null)?.decision;
  if (!d || typeof d !== "object") return null;
  const dd = d as Record<string, unknown>;
  if (dd.mode !== "automatique" && dd.mode !== "humaine") return null;
  return dd as unknown as DecisionCopie;
}

export function estCorrigeeAutomatiquement(feedback: unknown): boolean {
  return lireDecision(feedback)?.mode === "automatique";
}

/** Une copie notée peut-elle être révisée par l'encadrement ? (questions rédigées présentes) */
export function estRevisable(correction: Pick<ResultatCorrection, "details"> | null): boolean {
  return Boolean(correction?.details.some((d) => d.type === "open"));
}

/** Libellé neutre, sans moteur, pour les écrans. */
export function libelleDecision(decision: DecisionCopie | null): string {
  if (!decision) return "Corrigée";
  if (decision.revisee_le) return "Corrigée, puis révisée par un formateur";
  return decision.mode === "automatique" ? "Corrigée automatiquement" : "Corrigée par un formateur";
}

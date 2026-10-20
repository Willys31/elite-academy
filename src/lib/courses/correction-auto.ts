/**
 * Correction automatique des réponses rédigées — lot 27. Logique pure,
 * testée.
 *
 * Décision de Yakin (20/10/2026) : mode automatique partout, seuil de
 * confiance 70 %, correction humaine forçable activité par activité.
 * Rien ici ne nomme le moteur : les écrans parlent de « correction
 * automatique ».
 */

import type { PropositionsCopie } from "@/lib/ai/precorrection";
import type { NoteCorrecteur } from "@/lib/courses/questions";
import type { ResultatCorrection } from "@/lib/courses/progression";

export const SEUIL_CONFIANCE_DEFAUT = 0.7;

export interface ReglagesCorrectionAuto {
  /** CORRECTION_AUTO : on (défaut) | off. */
  actif: boolean;
  /** CORRECTION_SEUIL : 0 à 1 (défaut 0,7). */
  seuil: number;
}

export function lireReglagesCorrectionAuto(env: (nom: string) => string): ReglagesCorrectionAuto {
  const brut = env("CORRECTION_AUTO").trim().toLowerCase();
  const actif = !(brut === "off" || brut === "false" || brut === "0" || brut === "non");
  const seuilTexte = env("CORRECTION_SEUIL").trim().replace(",", ".");
  const seuilBrut = seuilTexte === "" ? Number.NaN : Number(seuilTexte);
  const seuil = Number.isFinite(seuilBrut) && seuilBrut >= 0 && seuilBrut <= 1 ? seuilBrut : SEUIL_CONFIANCE_DEFAUT;
  return { actif, seuil };
}

/** L'activité exige-t-elle une correction humaine (`content.correction_humaine`) ? */
export function correctionHumaineForcee(content: unknown): boolean {
  return Boolean(content && typeof content === "object" && (content as { correction_humaine?: unknown }).correction_humaine === true);
}

/**
 * Notes à poser automatiquement, ou null si un humain doit trancher :
 * chaque question en attente doit avoir une proposition au verdict net
 * (acquise / non acquise) et à la confiance ≥ seuil.
 */
export function decisionAutomatique(
  propositions: PropositionsCopie,
  questionsEnAttente: string[],
  seuil: number
): Record<string, NoteCorrecteur> | null {
  if (questionsEnAttente.length === 0) return null;
  const notes: Record<string, NoteCorrecteur> = {};
  for (const id of questionsEnAttente) {
    const p = propositions[id];
    if (!p || p.verdict === "incertain" || p.confiance < seuil || !p.feedback_apprenant) return null;
    notes[id] = { acquise: p.verdict === "acquise", commentaire: p.feedback_apprenant };
  }
  return notes;
}

/** Comment la copie a été décidée, rangé dans `attempts.feedback.decision`. */
export interface DecisionCopie {
  mode: "automatique" | "humaine";
  le: string;
  /** Relecture demandée par l'apprenant (copie automatique). */
  relecture?: { demandee_le: string; traitee_le?: string };
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

export function relectureDemandee(feedback: unknown): boolean {
  const d = lireDecision(feedback);
  return Boolean(d?.relecture?.demandee_le && !d.relecture.traitee_le);
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

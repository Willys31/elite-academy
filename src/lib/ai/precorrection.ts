/**
 * Pré-correction d'une réponse rédigée — lot 26, étape D. Logique pure,
 * testée : validation du JSON renvoyé par le modèle, pseudonymisation de
 * la réponse, passage proposition → note pré-remplie, quota, et écart
 * entre proposition et décision humaine (collecte pour un ajustement
 * ultérieur, lot 25 §5.5).
 */

import type { NoteCorrecteur } from "@/lib/courses/questions";

export const VERDICTS = ["acquise", "non_acquise", "incertain"] as const;
export type Verdict = (typeof VERDICTS)[number];

export const VERDICT_LABELS: Record<Verdict, string> = {
  acquise: "Acquise",
  non_acquise: "Non acquise",
  incertain: "Incertain",
};

/** Instructions projet §11. */
export const TYPES_DIFFICULTE = [
  "notion_non_comprise",
  "confusion",
  "mauvaise_lecture",
  "raisonnement_incomplet",
  "difficulte_application",
] as const;
export type TypeDifficulte = (typeof TYPES_DIFFICULTE)[number];

export const TYPE_DIFFICULTE_LABELS: Record<TypeDifficulte, string> = {
  notion_non_comprise: "Notion non comprise",
  confusion: "Confusion entre notions",
  mauvaise_lecture: "Mauvaise lecture de la consigne",
  raisonnement_incomplet: "Raisonnement incomplet",
  difficulte_application: "Difficulté d'application",
};

export interface CritereEvalue {
  critere: string;
  atteint: boolean | null;
  observation: string;
}

export interface PropositionCorrection {
  verdict: Verdict;
  /** 0 à 1. */
  confiance: number;
  criteres: CritereEvalue[];
  type_difficulte: TypeDifficulte | null;
  points_forts: string[];
  a_travailler: string[];
  feedback_apprenant: string;
  commentaire_formateur: string;
  warnings: string[];
}

/** Propositions d'une copie, indexées par identifiant de question. */
export type PropositionsCopie = Record<string, PropositionCorrection>;

export const LONGUEUR_MIN_REPONSE = 20;
export const LONGUEUR_MAX_FEEDBACK = 1200;

const texte = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const liste = (v: unknown, max = 6): string[] =>
  Array.isArray(v) ? v.map(texte).filter(Boolean).slice(0, max) : [];

/** Une réponse trop courte pour être jugée : on n'appelle pas le modèle. */
export function reponseTropCourte(reponse: string | null | undefined): boolean {
  return (reponse ?? "").trim().length < LONGUEUR_MIN_REPONSE;
}

/** Proposition « incertain » sans appel au modèle (réponse vide, IA indisponible, JSON inexploitable). */
export function propositionIncertaine(raison: string): PropositionCorrection {
  return {
    verdict: "incertain",
    confiance: 0,
    criteres: [],
    type_difficulte: null,
    points_forts: [],
    a_travailler: [],
    feedback_apprenant: "",
    commentaire_formateur: raison,
    warnings: [raison],
  };
}

/** Commentaire transmis à l'apprenant quand sa réponse est vide ou trop courte (lot 27 bis). */
export const FEEDBACK_REPONSE_INSUFFISANTE =
  "Votre réponse est vide ou trop courte pour être évaluée. Reprenez la consigne et les critères d'évaluation annoncés, développez chaque point en quelques phrases, puis renvoyez votre réponse.";

/** Réponse vide ou trop courte : notée non acquise sans appel au modèle (lot 27 bis). */
export function propositionReponseInsuffisante(): PropositionCorrection {
  return {
    verdict: "non_acquise",
    confiance: 1,
    criteres: [],
    type_difficulte: "raisonnement_incomplet",
    points_forts: [],
    a_travailler: ["Développer la réponse en suivant chaque critère d'évaluation."],
    feedback_apprenant: FEEDBACK_REPONSE_INSUFFISANTE,
    commentaire_formateur: "Réponse vide ou trop courte : notée non acquise sans analyse du contenu.",
    warnings: ["Réponse trop courte pour être analysée."],
  };
}

export type ValidationPrecorrection =
  | { ok: true; proposition: PropositionCorrection }
  | { ok: false; erreur: string };

/** Valide et normalise le JSON du modèle. Refuse un verdict inconnu ou un feedback vide. */
export function validerPrecorrection(brut: unknown): ValidationPrecorrection {
  if (brut === null || typeof brut !== "object" || Array.isArray(brut)) {
    return { ok: false, erreur: "La proposition de l'IA n'est pas un objet JSON." };
  }
  const r = brut as Record<string, unknown>;
  const verdict = texte(r.verdict).toLowerCase();
  if (!(VERDICTS as readonly string[]).includes(verdict)) {
    return { ok: false, erreur: `Verdict inconnu : « ${verdict || "vide"} ».` };
  }
  const feedback = texte(r.feedback_apprenant).slice(0, LONGUEUR_MAX_FEEDBACK);
  if (!feedback) return { ok: false, erreur: "La proposition ne contient pas de feedback pour l'apprenant." };

  const confianceBrute = Number(r.confiance);
  const confiance = Number.isFinite(confianceBrute) ? Math.min(1, Math.max(0, confianceBrute)) : 0.5;

  const criteres: CritereEvalue[] = (Array.isArray(r.criteres) ? r.criteres : [])
    .map((c) => {
      const cc = (c ?? {}) as Record<string, unknown>;
      return {
        critere: texte(cc.critere),
        atteint: typeof cc.atteint === "boolean" ? cc.atteint : null,
        observation: texte(cc.observation),
      };
    })
    .filter((c) => c.critere)
    .slice(0, 12);

  const difficulte = texte(r.type_difficulte).toLowerCase();
  return {
    ok: true,
    proposition: {
      verdict: verdict as Verdict,
      confiance,
      criteres,
      type_difficulte: (TYPES_DIFFICULTE as readonly string[]).includes(difficulte) ? (difficulte as TypeDifficulte) : null,
      points_forts: liste(r.points_forts),
      a_travailler: liste(r.a_travailler),
      feedback_apprenant: feedback,
      commentaire_formateur: texte(r.commentaire_formateur).slice(0, 600),
      warnings: liste(r.warnings),
    },
  };
}

function echapperRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Retire de la réponse les identités connues de l'apprenant (nom complet,
 * chaque partie du nom d'au moins trois lettres, adresse e-mail), ainsi
 * que toute adresse e-mail. Cadre légal §9 : minimisation avant envoi.
 */
export function pseudonymiser(texteReponse: string, identites: Array<string | null | undefined>): string {
  let resultat = texteReponse;
  const fragments = new Set<string>();
  for (const identite of identites) {
    const i = (identite ?? "").trim();
    if (!i) continue;
    fragments.add(i);
    for (const partie of i.split(/[\s-]+/)) if (partie.length >= 3 && !partie.includes("@")) fragments.add(partie);
  }
  for (const f of [...fragments].sort((a, b) => b.length - a.length)) {
    resultat = resultat.replace(new RegExp(`(?<![\\p{L}\\p{N}])${echapperRegex(f)}(?![\\p{L}\\p{N}])`, "giu"), "[apprenant]");
  }
  return resultat.replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[e-mail]");
}

/** Note pré-remplie pour le formateur à partir de la proposition. */
export function propositionVersNote(p: PropositionCorrection): NoteCorrecteur {
  return {
    acquise: p.verdict === "acquise",
    commentaire: p.feedback_apprenant || null,
  };
}

/** Résumé court des propositions d'une copie pour la file « Copies à corriger ». */
export function resumerPropositions(proposal: PropositionsCopie | null | undefined): string | null {
  const liste = Object.values(proposal ?? {});
  if (liste.length === 0) return null;
  const compte: Record<Verdict, number> = { acquise: 0, non_acquise: 0, incertain: 0 };
  for (const p of liste) compte[p.verdict] += 1;
  if (liste.length === 1) {
    const p = liste[0];
    return p.verdict === "incertain"
      ? "Correction proposée : incertain"
      : `Correction proposée : ${VERDICT_LABELS[p.verdict].toLowerCase()} (${Math.round(p.confiance * 100)} %)`;
  }
  const parts: string[] = [];
  if (compte.acquise) parts.push(`${compte.acquise} acquise${compte.acquise > 1 ? "s" : ""}`);
  if (compte.non_acquise) parts.push(`${compte.non_acquise} non acquise${compte.non_acquise > 1 ? "s" : ""}`);
  if (compte.incertain) parts.push(`${compte.incertain} incertain${compte.incertain > 1 ? "s" : ""}`);
  return `Correction proposée : ${parts.join(" · ")}`;
}

/** LLM_PRECORRECTIONS_PAR_JOUR : défaut 200 ; 0 désactive la pré-correction. */
export function lireQuotaPrecorrections(env: (nom: string) => string): number {
  const n = Number.parseInt(env("LLM_PRECORRECTIONS_PAR_JOUR"), 10);
  return Number.isInteger(n) && n >= 0 ? n : 200;
}

export function quotaAtteint(dejaAujourdhui: number, maximum: number): boolean {
  return maximum <= 0 || dejaAujourdhui >= maximum;
}

export interface EcartProposition {
  /** Toutes les notes posées suivent le verdict proposé (et aucun verdict n'était « incertain »). */
  validatedAsIs: boolean;
  finalVerdicts: Record<string, { acquise: boolean; commentaire: string | null; verdict_propose: Verdict | null }>;
}

/** Écart entre la proposition de l'IA et la décision du formateur. */
export function ecartProposition(
  proposal: PropositionsCopie,
  notes: Record<string, NoteCorrecteur | undefined>
): EcartProposition {
  const finalVerdicts: EcartProposition["finalVerdicts"] = {};
  let validatedAsIs = true;
  let notees = 0;
  for (const [questionId, note] of Object.entries(notes)) {
    if (!note) continue;
    notees += 1;
    const p = proposal[questionId];
    const verdictPropose = p?.verdict ?? null;
    finalVerdicts[questionId] = { acquise: note.acquise, commentaire: note.commentaire, verdict_propose: verdictPropose };
    if (!p || p.verdict === "incertain" || (p.verdict === "acquise") !== note.acquise) validatedAsIs = false;
  }
  if (notees === 0) validatedAsIs = false;
  return { validatedAsIs, finalVerdicts };
}

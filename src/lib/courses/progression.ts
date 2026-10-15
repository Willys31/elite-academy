/**
 * Correction des QCM et progression par compétence – logique pure.
 *
 * Règles (document global §10-§11, PRD §8, §10) :
 * - le niveau est suivi COMPÉTENCE PAR COMPÉTENCE, pas par moyenne
 *   générale ;
 * - le niveau Elite n'est JAMAIS attribué automatiquement : il exige
 *   une validation humaine (document global §19). Le calcul
 *   automatique plafonne donc à « advanced ».
 *
 * Barème : à partir des meilleurs scores obtenus par activité liée à
 * la compétence, moyenne >= 60 % → fundamentals, >= 80 % →
 * operational, >= 90 % → advanced. En dessous, la compétence reste
 * « en cours » (aucun niveau attribué).
 *
 * Le seuil Opérationnel était à 75 % (barème v1 du lot 4, « décision
 * temporaire signalée ») ; il est aligné le 15 octobre 2026 sur le
 * dossier fonctionnel (§4.2 et §9.4 : Fondamentaux 60 %, Opérationnel
 * 80 %, Avancé 90 %, Elite 95 % + validation formateur).
 */

export interface QuestionQcm {
  id: string;
  prompt: string;
  options: string[];
  bonneReponse: number; // index dans options
  explication?: string | null;
  competencyId?: string | null;
}

export interface CorrectionQuestion {
  questionId: string;
  reponseDonnee: number | null;
  correcte: boolean;
  bonneReponse: number;
  explication: string | null;
}

export interface ResultatCorrection {
  scorePourcent: number;
  nbCorrectes: number;
  nbQuestions: number;
  details: CorrectionQuestion[];
}

/** Corrige un QCM à partir des réponses { [questionId]: indexOption }. */
export function corrigerQcm(
  questions: QuestionQcm[],
  reponses: Record<string, number>
): ResultatCorrection {
  const details: CorrectionQuestion[] = questions.map((q) => {
    const donnee = Number.isInteger(reponses[q.id]) ? reponses[q.id] : null;
    const correcte = donnee !== null && donnee === q.bonneReponse;
    return {
      questionId: q.id,
      reponseDonnee: donnee,
      correcte,
      bonneReponse: q.bonneReponse,
      explication: q.explication ?? null,
    };
  });

  const nbCorrectes = details.filter((d) => d.correcte).length;
  const nbQuestions = questions.length;
  return {
    scorePourcent:
      nbQuestions === 0 ? 0 : Math.round((nbCorrectes / nbQuestions) * 100),
    nbCorrectes,
    nbQuestions,
    details,
  };
}

export type NiveauCalcule = "fundamentals" | "operational" | "advanced" | null;

export const NIVEAU_CALCULE_LABELS: Record<string, string> = {
  fundamentals: "Fondamentaux",
  operational: "Opérationnel",
  advanced: "Avancé",
  elite: "Elite",
};

/**
 * Niveau de maîtrise automatique à partir des meilleurs scores (%)
 * par activité liée à la compétence. Plafonné à « advanced » :
 * Elite exige une validation humaine.
 */
export function niveauDepuisScores(scores: number[]): NiveauCalcule {
  if (scores.length === 0) return null;
  const moyenne = scores.reduce((a, b) => a + b, 0) / scores.length;
  if (moyenne >= 90) return "advanced";
  if (moyenne >= 80) return "operational";
  if (moyenne >= 60) return "fundamentals";
  return null;
}

/** Pourcentage de complétion (leçons terminées / total), borné 0-100. */
export function calculerCompletion(
  leconsTerminees: number,
  totalLecons: number
): number {
  if (totalLecons <= 0) return 0;
  const pct = Math.round((leconsTerminees / totalLecons) * 100);
  return Math.max(0, Math.min(100, pct));
}

/**
 * Score d'une tentative POUR UNE COMPÉTENCE donnée.
 *
 * Principe non négociable du dossier fonctionnel (§23) : « ne pas
 * confondre note globale et maîtrise réelle ». Un QCM peut évaluer
 * deux compétences ; réussir toutes les questions de l'une et rater
 * celles de l'autre donnait auparavant le même score aux deux. Quand
 * les questions sont rattachées à des compétences, on ne retient que
 * celles de la compétence considérée. Si aucune question de la
 * tentative ne lui est rattachée (QCM lié à la compétence au niveau
 * de l'activité seulement, ou tentative ancienne sans détail), le
 * score global reste la seule preuve disponible.
 */
export function scorePourCompetence(
  tentative: { score: number | null; feedback: unknown },
  competencyId: string,
  competenceParQuestion: Record<string, string | null | undefined>
): number | null {
  const feedback = tentative.feedback as { details?: unknown } | null;
  const details = Array.isArray(feedback?.details)
    ? (feedback!.details as Array<{ questionId?: unknown; correcte?: unknown }>)
    : [];
  const concernees = details.filter(
    (d) => typeof d.questionId === "string" && competenceParQuestion[d.questionId] === competencyId
  );
  if (concernees.length === 0) {
    return tentative.score === null || !Number.isFinite(tentative.score) ? null : tentative.score;
  }
  const correctes = concernees.filter((d) => d.correcte === true).length;
  return Math.round((correctes / concernees.length) * 100);
}

/**
 * Conserve le meilleur score par activité (une tentative ratée après
 * une réussite ne fait pas baisser la maîtrise acquise).
 */
export function meilleursScoresParActivite(
  tentatives: Array<{ activityId: string; score: number | null }>
): number[] {
  const meilleurs = new Map<string, number>();
  for (const t of tentatives) {
    if (t.score === null || !Number.isFinite(t.score)) continue;
    const actuel = meilleurs.get(t.activityId);
    if (actuel === undefined || t.score > actuel) {
      meilleurs.set(t.activityId, t.score);
    }
  }
  return [...meilleurs.values()];
}

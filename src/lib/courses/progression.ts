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

import {
  estCorrigeAutomatiquement,
  reponseCourteAcceptee,
  type NoteCorrecteur,
  type QuestionCorrigeable,
  type ReponseDonnee,
  type TypeQuestion,
} from "@/lib/courses/questions";

/**
 * Question à corriger. `type` est facultatif pour les appels qui ne
 * manipulent que des QCM (tuteur IA, tests anciens) : absent, c'est un
 * QCM à choix unique. Pour les autres types, voir `lireQuestion` dans
 * `questions.ts`.
 */
export interface QuestionQcm {
  id: string;
  prompt: string;
  options: string[];
  bonneReponse: number; // index dans options (qcm, true_false)
  explication?: string | null;
  competencyId?: string | null;
  type?: TypeQuestion;
  /** Réponses acceptées (short_answer). */
  acceptees?: string[];
}

export interface CorrectionQuestion {
  questionId: string;
  type: TypeQuestion;
  reponseDonnee: ReponseDonnee;
  /** `null` : question ouverte en attente de la note du correcteur. */
  correcte: boolean | null;
  /** Index de la bonne option (qcm, true_false) ; -1 sinon. */
  bonneReponse: number;
  /** Réponse attendue montrée après correction (short_answer). */
  reponseAttendue: string | null;
  explication: string | null;
  /** Commentaire du correcteur (open, une fois notée). */
  commentaire: string | null;
}

export interface ResultatCorrection {
  /** `null` tant qu'une question attend sa note. */
  scorePourcent: number | null;
  nbCorrectes: number;
  nbQuestions: number;
  /** Questions ouvertes pas encore notées. */
  nbEnAttente: number;
  details: CorrectionQuestion[];
}

/** La tentative attend-elle encore une correction humaine ? */
export function tentativeEnAttente(correction: Pick<ResultatCorrection, "details">): boolean {
  return correction.details.some((d) => d.correcte === null);
}

/** Score en pourcentage des questions notées ; `null` s'il en reste à noter. */
function scoreDepuisDetails(details: CorrectionQuestion[]): Pick<
  ResultatCorrection,
  "scorePourcent" | "nbCorrectes" | "nbQuestions" | "nbEnAttente"
> {
  const nbQuestions = details.length;
  const nbCorrectes = details.filter((d) => d.correcte === true).length;
  const nbEnAttente = details.filter((d) => d.correcte === null).length;
  return {
    scorePourcent:
      nbQuestions === 0 ? 0 : nbEnAttente > 0 ? null : Math.round((nbCorrectes / nbQuestions) * 100),
    nbCorrectes,
    nbQuestions,
    nbEnAttente,
  };
}

/**
 * Corrige une activité à partir des réponses { [questionId]: réponse } :
 * index d'option (qcm, true_false), texte (short_answer, open), absent
 * si la question n'a pas été traitée.
 *
 * Les questions ouvertes ne sont PAS notées ici : leur détail porte
 * `correcte: null` et le score global reste `null` tant qu'un
 * correcteur ne les a pas tranchées (`appliquerNotes`).
 */
export function corrigerQcm(
  questions: Array<QuestionQcm | QuestionCorrigeable>,
  reponses: Record<string, ReponseDonnee | undefined>
): ResultatCorrection {
  const details: CorrectionQuestion[] = questions.map((q) => {
    const type: TypeQuestion = q.type ?? "qcm";
    const brute = reponses[q.id];
    const acceptees = q.acceptees ?? [];
    let donnee: ReponseDonnee = null;
    let correcte: boolean | null = false;

    if (type === "short_answer") {
      donnee = typeof brute === "string" && brute.trim() !== "" ? brute : null;
      correcte = reponseCourteAcceptee(donnee, acceptees);
    } else if (type === "open") {
      donnee = typeof brute === "string" && brute.trim() !== "" ? brute : null;
      // Sans réponse, rien à corriger : la question est ratée, pas en attente.
      correcte = donnee === null ? false : null;
    } else {
      donnee = typeof brute === "number" && Number.isInteger(brute) ? brute : null;
      correcte = donnee !== null && donnee === q.bonneReponse;
    }

    return {
      questionId: q.id,
      type,
      reponseDonnee: donnee,
      correcte,
      bonneReponse: estCorrigeAutomatiquement(type) && type !== "short_answer" ? q.bonneReponse : -1,
      reponseAttendue: type === "short_answer" ? (acceptees[0] ?? null) : null,
      explication: q.explication ?? null,
      commentaire: null,
    };
  });

  return { ...scoreDepuisDetails(details), details };
}

/**
 * Applique la note du correcteur aux questions ouvertes d'une
 * correction existante et recalcule le score. Les questions corrigées
 * automatiquement ne sont jamais modifiées : le correcteur note ce que
 * la machine ne sait pas noter, il ne révise pas ce qu'elle a fait.
 *
 * Retourne aussi les questions ouvertes restées sans note, pour que
 * l'action refuse une correction incomplète.
 */
export function appliquerNotes(
  correction: ResultatCorrection,
  notes: Record<string, NoteCorrecteur | undefined>
): { correction: ResultatCorrection; sansNote: string[] } {
  const sansNote: string[] = [];
  const details = correction.details.map((d) => {
    if (d.type !== "open") return d;
    const note = notes[d.questionId];
    if (!note) {
      if (d.correcte === null) sansNote.push(d.questionId);
      return d;
    }
    return {
      ...d,
      correcte: note.acquise,
      commentaire: note.commentaire?.trim() || null,
    };
  });
  return { correction: { ...scoreDepuisDetails(details), details }, sansNote };
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
 * score global reste la seule preuve disponible. Une question ouverte
 * en attente de correction ne compte pas (lot 23).
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
  const rattachees = details.filter(
    (d) => typeof d.questionId === "string" && competenceParQuestion[d.questionId] === competencyId
  );
  if (rattachees.length === 0) {
    return tentative.score === null || !Number.isFinite(tentative.score) ? null : tentative.score;
  }
  /* Une question ouverte pas encore notée (`correcte: null`) n'est ni
     juste ni fausse : elle ne compte qu'une fois la note posée. Si
     toutes les questions de la compétence attendent, pas de preuve. */
  const notees = rattachees.filter((d) => typeof d.correcte === "boolean");
  if (notees.length === 0) return null;
  const correctes = notees.filter((d) => d.correcte === true).length;
  return Math.round((correctes / notees.length) * 100);
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

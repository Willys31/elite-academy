/**
 * Exercices personnalisés générés par l'IA – logique pure, testable.
 *
 * Validation du JSON du LLM (même esprit que `validerResultat`),
 * séparation contenu / solution — la solution n'est jamais servie au
 * navigateur —, correction en réutilisant `corrigerQcm`.
 */

import { corrigerQcm, type QuestionQcm, type ResultatCorrection } from "@/lib/courses/progression";
import { TYPES_EXERCICE, type TypeExercice } from "@/lib/tutorat/blocage";

export interface QuestionGenereeExercice {
  prompt: string;
  options: string[];
  correct_index: number;
  explanation: string;
}

export interface ExerciceGenere {
  title: string;
  instructions: string;
  type: TypeExercice;
  difficulty: number;
  questions: QuestionGenereeExercice[];
}

export type ResultatExercices =
  | { ok: true; exercices: ExerciceGenere[] }
  | { ok: false; erreur: string };

const MAX_EXERCICES = 5;
const MAX_QUESTIONS = 5;

function texte(v: unknown, max = 2000): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

export function validerExercicesGeneres(brut: unknown): ResultatExercices {
  const racine = (brut && typeof brut === "object" ? (brut as Record<string, unknown>) : null);
  const liste = Array.isArray(brut) ? brut : racine && Array.isArray(racine.exercises) ? racine.exercises : null;
  if (!liste) return { ok: false, erreur: "La réponse de l'IA ne contient pas de liste d'exercices." };

  const exercices: ExerciceGenere[] = [];
  for (const e of liste.slice(0, MAX_EXERCICES)) {
    if (!e || typeof e !== "object") continue;
    const o = e as Record<string, unknown>;
    const title = texte(o.title, 160);
    if (!title) continue;
    const type = (TYPES_EXERCICE as readonly string[]).includes(String(o.type)) ? (o.type as TypeExercice) : "base";
    const difficulty = Math.min(5, Math.max(1, Math.round(Number(o.difficulty) || 2)));

    const questions: QuestionGenereeExercice[] = [];
    for (const q of Array.isArray(o.questions) ? o.questions.slice(0, MAX_QUESTIONS) : []) {
      if (!q || typeof q !== "object") continue;
      const x = q as Record<string, unknown>;
      const prompt = texte(x.prompt ?? x.question, 1000);
      const options = Array.isArray(x.options) ? x.options.map((op) => texte(op, 300)).filter(Boolean).slice(0, 6) : [];
      const correct = Number(x.correct_index);
      if (!prompt || options.length < 2 || !Number.isInteger(correct) || correct < 0 || correct >= options.length) continue;
      questions.push({ prompt, options, correct_index: correct, explanation: texte(x.explanation, 1500) });
    }
    if (questions.length === 0) continue;
    exercices.push({ title, instructions: texte(o.instructions, 1000), type, difficulty, questions });
  }

  if (exercices.length === 0) {
    return { ok: false, erreur: "Aucun exercice exploitable : questions sans options valides ou sans bonne réponse." };
  }
  return { ok: true, exercices };
}

export interface ContenuExercice {
  title: string;
  instructions: string;
  questions: Array<{ id: string; prompt: string; options: string[] }>;
}

export interface SolutionExercice {
  answers: Array<{ id: string; correct_index: number; explanation: string }>;
}

/** Sépare ce qui va au navigateur (contenu) de ce qui reste au serveur (solution). */
export function separerSolution(e: ExerciceGenere): { content: ContenuExercice; solution: SolutionExercice } {
  const ids = e.questions.map((_, i) => `q${i + 1}`);
  return {
    content: {
      title: e.title,
      instructions: e.instructions,
      questions: e.questions.map((q, i) => ({ id: ids[i], prompt: q.prompt, options: q.options })),
    },
    solution: {
      answers: e.questions.map((q, i) => ({ id: ids[i], correct_index: q.correct_index, explanation: q.explanation })),
    },
  };
}

export function corrigerExercice(
  content: ContenuExercice,
  solution: SolutionExercice,
  reponses: Record<string, number>
): ResultatCorrection {
  const parId = new Map(solution.answers.map((a) => [a.id, a]));
  const questions: QuestionQcm[] = content.questions.map((q) => ({
    id: q.id,
    prompt: q.prompt,
    options: q.options,
    bonneReponse: parId.get(q.id)?.correct_index ?? -1,
    explication: parId.get(q.id)?.explanation ?? null,
  }));
  return corrigerQcm(questions, reponses);
}

/** Lit les réponses `q_<id>` d'un formulaire. */
export function lireReponsesExercice(
  content: ContenuExercice,
  lire: (cle: string) => string | null
): Record<string, number> {
  const reponses: Record<string, number> = {};
  for (const q of content.questions) {
    const v = lire(`q_${q.id}`);
    if (v !== null && v !== "") reponses[q.id] = parseInt(v, 10);
  }
  return reponses;
}

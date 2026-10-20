/**
 * Activités rédigées — lot 26. Logique pure, testée.
 *
 * Une activité rédigée est une ligne `activities` de type `exercise`,
 * `case_study` ou `simulation` qui porte UNE question `open` (lot 23) :
 * l'apprenant répond par écrit, l'IA pré-corrige (lot 26, étape D), un
 * membre de l'encadrement valide. Le circuit des tentatives et de la
 * maîtrise par compétence est celui du lot 23.
 *
 * Ce module traduit :
 * - une activité du plan v2 (`ActiviteGeneree`, lot 25) en lignes à
 *   insérer (`activiteDepuisPlan`) ;
 * - le `content` d'une activité en structure typée tolérante
 *   (`lireContenuActiviteRedigee`) ;
 * - le formulaire de l'éditeur en activité (`lireFormulaireActiviteRedigee`).
 */

import type { ActiviteGeneree, MediaBriefGenere } from "@/lib/ai/schema";

export const TYPES_ACTIVITE_REDIGEE = ["exercise", "case_study", "simulation"] as const;
export type TypeActiviteRedigee = (typeof TYPES_ACTIVITE_REDIGEE)[number];

export const TYPE_ACTIVITE_REDIGEE_LABELS: Record<TypeActiviteRedigee, string> = {
  exercise: "Exercice",
  case_study: "Étude de cas",
  simulation: "Simulation",
};

/** Ce que l'éditeur attend dans la consigne, selon le type (workflows IA §6). */
export const TYPE_ACTIVITE_REDIGEE_AIDES: Record<TypeActiviteRedigee, string> = {
  exercise: "Une consigne précise, une situation professionnelle réaliste, ce que l'apprenant doit produire.",
  case_study: "Contexte, acteurs, informations disponibles, problème, contraintes, questions posées, livrable attendu.",
  simulation: "Rôle de l'apprenant, contexte, objectif, événements possibles, condition de réussite.",
};

export function estActiviteRedigee(type: unknown): type is TypeActiviteRedigee {
  return typeof type === "string" && (TYPES_ACTIVITE_REDIGEE as readonly string[]).includes(type);
}

export function lireTypeActiviteRedigee(valeur: unknown): TypeActiviteRedigee {
  return estActiviteRedigee(valeur) ? valeur : "exercise";
}

/** Limites de saisie (éditeur et apprenant). */
export const LONGUEUR_MAX_CONSIGNE = 6000;
export const LONGUEUR_MAX_CHAMP = 2000;

export interface ContenuActiviteRedigee {
  expected_outcome: string;
  evaluation: string;
  situation_type: string | null;
  competency_refs: string[];
  media_brief: MediaBriefGenere | null;
  generated_by_ai: boolean;
  prompt_version: string | null;
  /** Lot 27 : exiger une correction humaine (contenu certifiant, sensible). */
  correction_humaine: boolean;
}

const texte = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/** Lecture tolérante de `activities.content` pour une activité rédigée. */
export function lireContenuActiviteRedigee(brut: unknown): ContenuActiviteRedigee {
  const c = (brut && typeof brut === "object" && !Array.isArray(brut) ? brut : {}) as Record<string, unknown>;
  const media = c.media_brief && typeof c.media_brief === "object" ? (c.media_brief as Record<string, unknown>) : null;
  return {
    expected_outcome: texte(c.expected_outcome),
    evaluation: texte(c.evaluation),
    situation_type: texte(c.situation_type) || null,
    competency_refs: Array.isArray(c.competency_refs) ? c.competency_refs.map(texte).filter(Boolean) : [],
    media_brief:
      media && (texte(media.kind) || texte(media.description))
        ? { kind: texte(media.kind).toLowerCase(), purpose: texte(media.purpose), description: texte(media.description) }
        : null,
    generated_by_ai: c.generated_by_ai === true,
    prompt_version: texte(c.prompt_version) || null,
    correction_humaine: c.correction_humaine === true,
  };
}

/**
 * Grille du correcteur (`questions.expected_answer.rubric`, illisible de
 * l'apprenant) : résultat attendu + critères. L'apprenant voit les mêmes
 * éléments dans `activities.content` (hypothèse H4) ; la grille sert à
 * la pré-correction et au formateur.
 */
export function grilleDepuisActivite(c: { expected_outcome: string; evaluation: string }): string {
  const parties: string[] = [];
  if (c.expected_outcome) parties.push(`Résultat attendu : ${c.expected_outcome}`);
  if (c.evaluation) parties.push(`Critères d'évaluation : ${c.evaluation}`);
  return parties.join("\n\n");
}

export interface ActiviteRedigeeACreer {
  activite: {
    type: TypeActiviteRedigee;
    title: string;
    instructions: string;
    content: ContenuActiviteRedigee;
    difficulty: number;
  };
  question: {
    type: "open";
    prompt: string;
    expected_answer: { rubric: string };
    difficulty: number;
  };
  /** Noms des compétences visées (à résoudre en identifiants par l'appelant). */
  competences: string[];
}

function borner(n: unknown, defaut: number): number {
  const v = Number(n);
  return Number.isInteger(v) && v >= 1 && v <= 5 ? v : defaut;
}

/**
 * Activité du plan v2 → lignes à créer. Les quiz ne passent pas ici
 * (ils ont leur propre circuit) ; une `open_question` devient un
 * exercice. Renvoie null si l'activité n'a pas de consigne.
 */
export function activiteDepuisPlan(
  a: ActiviteGeneree,
  options: { prompt_version: string }
): ActiviteRedigeeACreer | null {
  if (a.type === "quiz") return null;
  const type: TypeActiviteRedigee = estActiviteRedigee(a.type) ? a.type : "exercise";
  const instructions = a.instructions.trim().slice(0, LONGUEUR_MAX_CONSIGNE);
  if (!instructions) return null;
  const content: ContenuActiviteRedigee = {
    expected_outcome: a.expected_outcome.slice(0, LONGUEUR_MAX_CHAMP),
    evaluation: a.evaluation.slice(0, LONGUEUR_MAX_CHAMP),
    situation_type: a.situation_type,
    competency_refs: a.competency_refs,
    media_brief: a.media_brief,
    generated_by_ai: true,
    prompt_version: options.prompt_version,
    correction_humaine: false,
  };
  const difficulty = borner(a.difficulty, 2);
  return {
    activite: { type, title: a.title.trim() || TYPE_ACTIVITE_REDIGEE_LABELS[type], instructions, content, difficulty },
    question: { type: "open", prompt: instructions, expected_answer: { rubric: grilleDepuisActivite(content) }, difficulty },
    competences: a.competency_refs,
  };
}

/** Bloc « — Activités — » ajouté au texte des leçons par le lot 25 (à retirer lors de la reprise). */
const BLOC_ACTIVITES = /\n*— Activités —[\s\S]*$/;

export function retirerBlocActivites(texteLecon: string): string {
  return texteLecon.replace(BLOC_ACTIVITES, "").trimEnd();
}

export type LectureFormulaire =
  | { ok: true; valeur: ActiviteRedigeeACreer }
  | { ok: false; erreur: string };

/**
 * Formulaire de l'éditeur (étape B) → activité à créer ou à mettre à
 * jour. Messages d'erreur en français, prêts pour l'écran.
 */
export function lireFormulaireActiviteRedigee(lire: (nom: string) => string): LectureFormulaire {
  const type = lireTypeActiviteRedigee(lire("type"));
  const title = lire("title").trim();
  const instructions = lire("instructions").trim();
  const expected_outcome = lire("expected_outcome").trim();
  const evaluation = lire("evaluation").trim();
  if (!title) return { ok: false, erreur: "Veuillez saisir le titre de l'activité." };
  if (!instructions) return { ok: false, erreur: "Veuillez rédiger la consigne." };
  if (instructions.length > LONGUEUR_MAX_CONSIGNE) {
    return { ok: false, erreur: `La consigne dépasse ${LONGUEUR_MAX_CONSIGNE} caractères.` };
  }
  if (!evaluation) return { ok: false, erreur: "Indiquez les critères d'évaluation : c'est sur eux que l'IA et le formateur corrigeront." };
  if (expected_outcome.length > LONGUEUR_MAX_CHAMP || evaluation.length > LONGUEUR_MAX_CHAMP) {
    return { ok: false, erreur: `Le résultat attendu et les critères font ${LONGUEUR_MAX_CHAMP} caractères au maximum chacun.` };
  }
  const content: ContenuActiviteRedigee = {
    expected_outcome,
    evaluation,
    situation_type: lire("situation_type").trim() || null,
    competency_refs: [],
    media_brief: null,
    generated_by_ai: false,
    prompt_version: null,
    correction_humaine: lire("correction_humaine") === "on" || lire("correction_humaine") === "true",
  };
  const difficulty = borner(lire("difficulty"), 2);
  return {
    ok: true,
    valeur: {
      activite: { type, title, instructions, content, difficulty },
      question: { type: "open", prompt: instructions, expected_answer: { rubric: grilleDepuisActivite(content) }, difficulty },
      competences: [],
    },
  };
}

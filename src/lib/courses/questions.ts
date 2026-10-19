/**
 * Types de questions (PRD §14) – logique pure, testable unitairement.
 *
 * Quatre types, un seul circuit de correction :
 *
 *   qcm           choix unique parmi des options ; corrigé à la soumission
 *   true_false    deux options fixes (Vrai / Faux) ; corrigé à la soumission
 *   short_answer  réponse libre courte, comparée aux réponses acceptées
 *                 sans tenir compte de la casse, des accents ni des
 *                 espaces superflus ; corrigée à la soumission
 *   open          réponse libre longue ; AUCUNE correction automatique :
 *                 un membre de l'encadrement note (acquise / non acquise)
 *                 et commente. Tant que ce n'est pas fait, la tentative
 *                 est « en attente de correction » et la question ne
 *                 compte ni dans le score ni dans la maîtrise.
 *
 * Ce module ne lit ni n'écrit rien : il nomme les types, normalise les
 * réponses courtes, lit les lignes `questions` telles que la base les
 * renvoie et applique la note du correcteur à un feedback existant.
 * La correction proprement dite est dans `progression.ts`
 * (`corrigerQcm`), qui s'appuie sur ces fonctions.
 */

export type TypeQuestion = "qcm" | "true_false" | "short_answer" | "open";

export const TYPES_QUESTION: TypeQuestion[] = ["qcm", "true_false", "short_answer", "open"];

export const TYPE_QUESTION_LABELS: Record<TypeQuestion, string> = {
  qcm: "QCM (choix unique)",
  true_false: "Vrai / Faux",
  short_answer: "Réponse courte",
  open: "Question ouverte",
};

/** Explication courte du type, affichée dans l'éditeur. */
export const TYPE_QUESTION_AIDES: Record<TypeQuestion, string> = {
  qcm: "Deux à quatre options, une seule bonne réponse. Corrigé immédiatement.",
  true_false: "Une affirmation, deux options fixes. Corrigé immédiatement.",
  short_answer:
    "L'apprenant saisit un mot ou une expression. Corrigé immédiatement si sa réponse figure parmi les réponses acceptées (majuscules, accents et espaces ignorés).",
  open:
    "L'apprenant rédige librement. Pas de correction automatique : vous notez et commentez depuis Résultats → Copies à corriger.",
};

/** Options fixes d'une question vrai/faux, dans cet ordre. */
export const OPTIONS_VRAI_FAUX: readonly [string, string] = ["Vrai", "Faux"];

/** Toute valeur inconnue (ancienne ligne, import) est lue comme un QCM. */
export function lireTypeQuestion(valeur: unknown): TypeQuestion {
  return TYPES_QUESTION.includes(valeur as TypeQuestion) ? (valeur as TypeQuestion) : "qcm";
}

/** Le type se corrige-t-il sans intervention humaine ? */
export function estCorrigeAutomatiquement(type: TypeQuestion): boolean {
  return type !== "open";
}

/** Le type attend-il un texte libre plutôt qu'un choix parmi des options ? */
export function estReponseLibre(type: TypeQuestion): boolean {
  return type === "short_answer" || type === "open";
}

/**
 * Forme canonique d'une réponse courte : minuscules, sans accents ni
 * signes diacritiques, espaces réduits à un seul, ponctuation de bord
 * retirée. « L'Éducation nationale. » et « l'education   nationale »
 * sont ainsi la même réponse.
 */
export function normaliserReponseCourte(texte: string): string {
  return texte
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[\s.,;:!?"«»()\-]+|[\s.,;:!?"«»()\-]+$/g, "")
    .trim();
}

/** La réponse donnée figure-t-elle parmi les réponses acceptées ? */
export function reponseCourteAcceptee(donnee: string | null | undefined, acceptees: string[]): boolean {
  if (donnee === null || donnee === undefined) return false;
  const forme = normaliserReponseCourte(donnee);
  if (forme === "") return false;
  return acceptees.some((a) => normaliserReponseCourte(a) === forme);
}

/**
 * Réponses acceptées saisies par le concepteur : une par ligne (ou
 * séparées par des points-virgules), vides et doublons retirés. L'ordre
 * est conservé : la première est celle montrée à l'apprenant après
 * correction.
 */
export function lireReponsesAcceptees(saisie: string): string[] {
  const vues = new Set<string>();
  const resultat: string[] = [];
  for (const brute of saisie.split(/[\n;]/)) {
    const propre = brute.trim();
    if (!propre) continue;
    const cle = normaliserReponseCourte(propre);
    if (!cle || vues.has(cle)) continue;
    vues.add(cle);
    resultat.push(propre);
  }
  return resultat;
}

/** Question telle que la correction la manipule (corrigé compris). */
export interface QuestionCorrigeable {
  id: string;
  type: TypeQuestion;
  prompt: string;
  options: string[];
  /** Index de la bonne option (qcm, true_false) ; -1 sinon. */
  bonneReponse: number;
  /** Réponses acceptées (short_answer) ; vide sinon. */
  acceptees: string[];
  /** Éléments attendus montrés au correcteur (open). */
  grille: string | null;
  explication: string | null;
  competencyId: string | null;
}

/**
 * Lit une ligne `questions` telle que Supabase la renvoie (avec les
 * corrigés : donc depuis le client d'administration). Tout ce qui n'a
 * pas la forme attendue retombe sur une valeur neutre plutôt que de
 * faire échouer la correction entière.
 */
export function lireQuestion(ligne: {
  id: string;
  type?: unknown;
  prompt: string;
  options?: unknown;
  expected_answer?: unknown;
  explanation?: string | null;
  competency_id?: string | null;
}): QuestionCorrigeable {
  const type = lireTypeQuestion(ligne.type);
  const attendu = (ligne.expected_answer ?? {}) as {
    index?: unknown;
    accepted?: unknown;
    rubric?: unknown;
  };
  const options = Array.isArray(ligne.options)
    ? (ligne.options as unknown[]).filter((o): o is string => typeof o === "string")
    : [];
  return {
    id: ligne.id,
    type,
    prompt: ligne.prompt,
    options: type === "true_false" && options.length !== 2 ? [...OPTIONS_VRAI_FAUX] : options,
    bonneReponse:
      (type === "qcm" || type === "true_false") && Number.isInteger(attendu.index)
        ? (attendu.index as number)
        : -1,
    acceptees:
      type === "short_answer" && Array.isArray(attendu.accepted)
        ? (attendu.accepted as unknown[]).filter((a): a is string => typeof a === "string")
        : [],
    grille: type === "open" && typeof attendu.rubric === "string" ? attendu.rubric : null,
    explication: ligne.explanation ?? null,
    competencyId: ligne.competency_id ?? null,
  };
}

/**
 * Réponse d'un apprenant à une question, telle qu'elle arrive du
 * formulaire : un index d'option pour un choix, un texte pour une
 * réponse libre, rien si la question a été laissée vide.
 */
export type ReponseDonnee = number | string | null;

/**
 * Interprète la valeur brute d'un champ de formulaire selon le type de
 * la question. Un texte vide ou un index non entier valent « pas de
 * réponse ». Les réponses libres sont bornées pour ne pas stocker un
 * roman dans `attempts.answers`.
 */
export const LONGUEUR_MAX_REPONSE_LIBRE = 4000;

export function lireReponse(type: TypeQuestion, brute: unknown): ReponseDonnee {
  if (brute === null || brute === undefined) return null;
  const texte = String(brute);
  if (estReponseLibre(type)) {
    const propre = texte.trim();
    return propre === "" ? null : propre.slice(0, LONGUEUR_MAX_REPONSE_LIBRE);
  }
  const index = parseInt(texte, 10);
  return Number.isInteger(index) && index >= 0 ? index : null;
}

/** Note posée par le correcteur sur une question ouverte. */
export interface NoteCorrecteur {
  acquise: boolean;
  commentaire: string | null;
}

/** Libellés des statuts de tentative montrés à l'écran. */
export const STATUT_TENTATIVE_LABELS: Record<string, string> = {
  in_progress: "En cours",
  submitted: "Soumise",
  graded: "Corrigée",
  pending_review: "En attente de correction",
};

export function estEnAttenteDeCorrection(statut: string | null | undefined): boolean {
  return statut === "pending_review";
}

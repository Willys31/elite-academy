/**
 * Situations de travail – logique pure, testable.
 *
 * Addendum Situations de travail : template CSRR (§4.1) et bornes de
 * longueur (§4.2), 1 à 5 compétences, secteur, anonymisation, niveau
 * de partage (§3), tri (§8), badges Storyteller / Expert de secteur /
 * Problem Solver (§6).
 */

export const LIMITES_CSRR = {
  title: [5, 120],
  context: [100, 500],
  situation: [150, 800],
  resolution: [150, 800],
  result: [100, 500],
} as const;

export type ChampCsrr = keyof typeof LIMITES_CSRR;

export const LIBELLES_CSRR: Record<ChampCsrr, string> = {
  title: "Titre",
  context: "Contexte",
  situation: "Situation",
  resolution: "Résolution",
  result: "Résultat",
};

export const AIDES_CSRR: Record<ChampCsrr, string> = {
  title: "Court et explicite : « Gestion d'un produit défectueux – client VIP ».",
  context: "Entreprise, secteur, votre rôle, l'environnement. Sans nom de client ni chiffre confidentiel.",
  situation: "La problématique rencontrée, le défi, l'enjeu.",
  resolution: "Ce que vous avez fait, les compétences mobilisées, les décisions prises.",
  result: "L'issue, les retours, ce que vous en avez appris.",
};

export const MIN_COMPETENCES = 1;
export const MAX_COMPETENCES = 5;
export const MAX_TAGS = 8;

export const SECTEURS = [
  "luxe",
  "retail",
  "banque",
  "assurance",
  "hotellerie",
  "restauration",
  "sante",
  "telecoms",
  "education",
  "administration",
  "autre",
] as const;
export type Secteur = (typeof SECTEURS)[number];

export const SECTEUR_LABELS: Record<Secteur, string> = {
  luxe: "Luxe",
  retail: "Retail",
  banque: "Banque",
  assurance: "Assurance",
  hotellerie: "Hôtellerie",
  restauration: "Restauration",
  sante: "Santé",
  telecoms: "Télécommunications",
  education: "Éducation",
  administration: "Administration publique",
  autre: "Autre",
};

export function secteurValide(v: unknown): v is Secteur {
  return typeof v === "string" && (SECTEURS as readonly string[]).includes(v);
}

/**
 * Secteur proposé par défaut : celui de la formation, sinon celui de
 * l'organisation, ramené à la liste connue (« autre » sinon).
 */
export function secteurParDefaut(
  secteurFormation: string | null | undefined,
  secteurOrganisation: string | null | undefined
): Secteur {
  for (const brut of [secteurFormation, secteurOrganisation]) {
    const cle = (brut ?? "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .trim();
    if (secteurValide(cle)) return cle;
    const partiel = SECTEURS.find((s) => s !== "autre" && cle.includes(s));
    if (partiel) return partiel;
  }
  return "autre";
}

function nettoyer(texte: string): string {
  return texte.replace(/\r\n?/g, "\n").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

export interface ChampsSituation {
  title: string;
  context: string;
  situation: string;
  resolution: string;
  result: string;
}

export interface ResultatValidation {
  ok: boolean;
  erreurs: string[];
  champs: ChampsSituation;
}

/** Vérifie chaque champ CSRR et le nombre de compétences ; renvoie les champs nettoyés. */
export function validerSituation(
  brut: ChampsSituation,
  nbCompetences: number
): ResultatValidation {
  const champs: ChampsSituation = {
    title: nettoyer(brut.title),
    context: nettoyer(brut.context),
    situation: nettoyer(brut.situation),
    resolution: nettoyer(brut.resolution),
    result: nettoyer(brut.result),
  };
  const erreurs: string[] = [];
  for (const cle of Object.keys(LIMITES_CSRR) as ChampCsrr[]) {
    const [min, max] = LIMITES_CSRR[cle];
    const longueur = champs[cle].length;
    if (longueur < min) {
      erreurs.push(`${LIBELLES_CSRR[cle]} : ${min} caractères minimum (${longueur} saisis).`);
    } else if (longueur > max) {
      erreurs.push(`${LIBELLES_CSRR[cle]} : ${max} caractères maximum (${longueur} saisis).`);
    }
  }
  if (nbCompetences < MIN_COMPETENCES) {
    erreurs.push("Choisissez au moins une compétence mobilisée.");
  } else if (nbCompetences > MAX_COMPETENCES) {
    erreurs.push(`Choisissez au plus ${MAX_COMPETENCES} compétences.`);
  }
  return { ok: erreurs.length === 0, erreurs, champs };
}

/** « client VIP, Réclamation ,fidélisation » → ["client vip", "réclamation", "fidélisation"]. */
export function normaliserTags(saisie: string): string[] {
  const vus = new Set<string>();
  const tags: string[] = [];
  for (const brut of saisie.split(/[,;\n]/)) {
    const tag = brut.trim().replace(/\s+/g, " ").toLowerCase().replace(/^#/, "");
    if (tag.length < 2 || tag.length > 30 || vus.has(tag)) continue;
    vus.add(tag);
    tags.push(tag);
    if (tags.length >= MAX_TAGS) break;
  }
  return tags;
}

/** Auteur affiché : nom réel, ou périphrase quand la situation est anonymisée. */
export function libelleAuteur(params: {
  isAnonymized: boolean;
  fullName: string | null | undefined;
  secteur: string;
}): string {
  if (!params.isAnonymized && params.fullName?.trim()) return params.fullName.trim();
  const secteur = secteurValide(params.secteur) ? SECTEUR_LABELS[params.secteur].toLowerCase() : params.secteur;
  return `Un apprenant d'une entreprise du secteur ${secteur}`;
}

export const STATUT_SITUATION_LABELS: Record<string, string> = {
  submitted: "En attente de validation",
  validated: "Publiée",
  rejected: "Refusée",
};

export const TON_STATUT_SITUATION: Record<string, "neutre" | "or" | "succes" | "alerte"> = {
  submitted: "or",
  validated: "succes",
  rejected: "alerte",
};

export type TriSituations = "utiles" | "recentes";

export function triValide(v: unknown): v is TriSituations {
  return v === "utiles" || v === "recentes";
}

export function trierSituations<T extends { useful_votes_count: number; created_at: string }>(
  liste: T[],
  tri: TriSituations
): T[] {
  return [...liste].sort((a, b) => {
    if (tri === "utiles" && b.useful_votes_count !== a.useful_votes_count) {
      return b.useful_votes_count - a.useful_votes_count;
    }
    return b.created_at < a.created_at ? -1 : b.created_at > a.created_at ? 1 : 0;
  });
}

/** Storyteller : 10 situations validées avec ≥ 5 votes « Utile » en moyenne. */
export const STORYTELLER_SITUATIONS = 10;
export const STORYTELLER_MOYENNE_VOTES = 5;
export const EXPERT_SECTEUR_SITUATIONS = 5;

export interface CompteursSituations {
  situations_validees: number;
  situations_storyteller: number;
  moyenne_votes: number;
  situations_secteur: Record<string, number>;
  problem_solver: number;
}

/**
 * Compteurs dérivés des situations validées d'un apprenant.
 * `situations_storyteller` vaut le nombre de situations validées
 * uniquement si la moyenne de votes atteint le seuil, sinon 0 : le
 * badge se lit ainsi avec un simple compteur à cible.
 */
export function compteursSituations(
  validees: Array<{ votes: number; sector: string; isComplexProblem: boolean }>
): CompteursSituations {
  const n = validees.length;
  const totalVotes = validees.reduce((s, v) => s + Math.max(0, v.votes), 0);
  const moyenne = n === 0 ? 0 : totalVotes / n;
  const parSecteur: Record<string, number> = {};
  for (const v of validees) parSecteur[v.sector] = (parSecteur[v.sector] ?? 0) + 1;
  return {
    situations_validees: n,
    situations_storyteller: moyenne >= STORYTELLER_MOYENNE_VOTES ? n : 0,
    moyenne_votes: Math.round(moyenne * 10) / 10,
    situations_secteur: parSecteur,
    problem_solver: validees.filter((v) => v.isComplexProblem).length,
  };
}

export function storytellerAtteint(n: number, moyenneVotes: number): boolean {
  return n >= STORYTELLER_SITUATIONS && moyenneVotes >= STORYTELLER_MOYENNE_VOTES;
}

/** Secteurs pour lesquels le badge « Expert de secteur » est acquis. */
export function secteursExperts(parSecteur: Record<string, number>): string[] {
  return Object.entries(parSecteur)
    .filter(([, n]) => n >= EXPERT_SECTEUR_SITUATIONS)
    .map(([s]) => s)
    .sort();
}

/**
 * Sessions présentielles – logique pure, testable.
 * Codes de session lisibles et agrégation des résultats en direct.
 */

/** Alphabet sans caractères ambigus (pas de O/0, I/1, etc.). */
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const LONGUEUR_CODE = 6;

/**
 * Génère un code de session lisible (6 caractères).
 * La source aléatoire est injectable pour les tests.
 */
export function genererCodeSession(
  aleatoire: () => number = Math.random
): string {
  let code = "";
  for (let i = 0; i < LONGUEUR_CODE; i++) {
    const index = Math.floor(aleatoire() * ALPHABET.length);
    code += ALPHABET[Math.min(index, ALPHABET.length - 1)];
  }
  return code;
}

/** Normalise une saisie de code (espaces, minuscules, tirets). */
export function normaliserCode(saisie: string): string {
  return saisie.replace(/[\s-]/g, "").toUpperCase();
}

/** Le code a-t-il un format valide ? */
export function codeValide(code: string): boolean {
  const c = normaliserCode(code);
  if (c.length !== LONGUEUR_CODE) return false;
  return [...c].every((ch) => ALPHABET.includes(ch));
}

export interface TentativeSession {
  userId: string;
  score: number | null;
}

export interface StatsDirect {
  nbReponses: number;
  nbRepondants: number;
  moyenne: number | null;
  repartition: { tranche: string; nombre: number }[];
}

/**
 * Agrège les résultats en direct d'une activité de session :
 * nombre de réponses, répondants uniques, moyenne, répartition
 * par tranche de score. Ignore les scores manquants.
 */
export function agregerResultats(tentatives: TentativeSession[]): StatsDirect {
  const valides = tentatives.filter(
    (t) => t.score !== null && Number.isFinite(t.score)
  );
  const repondants = new Set(valides.map((t) => t.userId));

  const tranches = [
    { tranche: "0-49 %", min: 0, max: 49 },
    { tranche: "50-74 %", min: 50, max: 74 },
    { tranche: "75-89 %", min: 75, max: 89 },
    { tranche: "90-100 %", min: 90, max: 100 },
  ];
  const repartition = tranches.map((t) => ({
    tranche: t.tranche,
    nombre: valides.filter(
      (v) => (v.score as number) >= t.min && (v.score as number) <= t.max
    ).length,
  }));

  return {
    nbReponses: valides.length,
    nbRepondants: repondants.size,
    moyenne:
      valides.length === 0
        ? null
        : Math.round(
            valides.reduce((a, b) => a + (b.score as number), 0) / valides.length
          ),
    repartition,
  };
}

export const SESSION_STATUS_LABELS: Record<string, string> = {
  scheduled: "Programmée",
  open: "Ouverte",
  closed: "Clôturée",
};

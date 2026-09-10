/**
 * Révision – logique pure, testable unitairement.
 *
 * Ce que l'écran « Ma révision » doit montrer : ce que l'apprenant ne
 * sait PAS encore, au moment où il regarde. D'où deux décisions qui ne
 * vont pas de soi et qu'il faut expliciter.
 *
 * 1. On part de la DERNIÈRE tentative de chaque activité, pas de la
 *    meilleure. La maîtrise, elle, retient le meilleur score
 *    (`meilleursScoresParActivite`) : une réussite acquise ne doit pas
 *    se perdre. Mais réviser sur un ancien meilleur essai ferait
 *    disparaître de la liste une question ratée aujourd'hui — soit
 *    exactement celle qu'il faut revoir. Les deux règles diffèrent
 *    parce qu'elles répondent à deux questions différentes : « qu'ai-je
 *    prouvé ? » et « que dois-je retravailler ? ».
 *
 * 2. Une activité entièrement réussie à la dernière tentative sort de
 *    la liste. Rien à réviser n'est un résultat, pas un écran vide.
 */

/** Détail d'une question tel qu'il est stocké dans `attempts.feedback`. */
export interface DetailTentative {
  questionId: string;
  reponseDonnee: number | null;
  correcte: boolean;
  bonneReponse: number;
  explication: string | null;
}

export interface TentativeBrute {
  activityId: string;
  score: number | null;
  /** Date de soumission ISO ; à défaut, date de début. */
  horodatage: string | null;
  details: DetailTentative[];
}

/** Une question à retravailler, rattachée à son activité. */
export interface QuestionARevoir {
  activityId: string;
  questionId: string;
  reponseDonnee: number | null;
  bonneReponse: number;
  explication: string | null;
}

/**
 * Ne conserve, pour chaque activité, que la tentative la plus récente.
 * Une tentative sans horodatage est considérée comme la plus ancienne :
 * elle ne peut pas évincer une tentative datée.
 */
export function dernieresTentatives(
  tentatives: TentativeBrute[]
): Map<string, TentativeBrute> {
  const parActivite = new Map<string, TentativeBrute>();
  for (const t of tentatives) {
    const actuelle = parActivite.get(t.activityId);
    if (actuelle === undefined || plusRecente(t, actuelle)) {
      parActivite.set(t.activityId, t);
    }
  }
  return parActivite;
}

function plusRecente(a: TentativeBrute, b: TentativeBrute): boolean {
  const da = a.horodatage ? Date.parse(a.horodatage) : Number.NEGATIVE_INFINITY;
  const db = b.horodatage ? Date.parse(b.horodatage) : Number.NEGATIVE_INFINITY;
  if (Number.isNaN(da)) return false;
  if (Number.isNaN(db)) return true;
  return da > db;
}

/**
 * Questions ratées à la dernière tentative de chaque activité.
 * Une question laissée sans réponse compte comme ratée : ne pas savoir
 * répondre et répondre faux se révisent de la même façon.
 */
export function questionsARevoir(
  tentatives: TentativeBrute[]
): QuestionARevoir[] {
  const aRevoir: QuestionARevoir[] = [];
  for (const t of dernieresTentatives(tentatives).values()) {
    for (const d of t.details) {
      if (d.correcte) continue;
      aRevoir.push({
        activityId: t.activityId,
        questionId: d.questionId,
        reponseDonnee: d.reponseDonnee,
        bonneReponse: d.bonneReponse,
        explication: d.explication,
      });
    }
  }
  return aRevoir;
}

/** Activités dont la dernière tentative comporte au moins une erreur. */
export function activitesARevoir(tentatives: TentativeBrute[]): string[] {
  const ids = new Set<string>();
  for (const q of questionsARevoir(tentatives)) ids.add(q.activityId);
  return [...ids];
}

/**
 * Lit une ligne `attempts` telle que la renvoie Supabase et en extrait
 * la forme utilisable ici. Le champ `feedback` est un JSON libre côté
 * base : tout ce qui n'a pas la forme attendue est ignoré plutôt que de
 * faire échouer l'écran entier.
 */
export function lireTentative(ligne: {
  activity_id: string;
  score: number | string | null;
  submitted_at?: string | null;
  started_at?: string | null;
  feedback?: unknown;
}): TentativeBrute {
  const feedback = ligne.feedback as { details?: unknown } | null | undefined;
  const brut = Array.isArray(feedback?.details) ? feedback.details : [];

  const details: DetailTentative[] = [];
  for (const d of brut) {
    if (typeof d !== "object" || d === null) continue;
    const o = d as Record<string, unknown>;
    if (typeof o.questionId !== "string") continue;
    details.push({
      questionId: o.questionId,
      reponseDonnee:
        typeof o.reponseDonnee === "number" ? o.reponseDonnee : null,
      correcte: o.correcte === true,
      bonneReponse: typeof o.bonneReponse === "number" ? o.bonneReponse : -1,
      explication: typeof o.explication === "string" ? o.explication : null,
    });
  }

  return {
    activityId: ligne.activity_id,
    score: ligne.score === null || ligne.score === undefined ? null : Number(ligne.score),
    horodatage: ligne.submitted_at ?? ligne.started_at ?? null,
    details,
  };
}

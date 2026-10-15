/**
 * Test de positionnement – logique pure, testable unitairement.
 *
 * PRD §9 : « mesurer le niveau initial, identifier les acquis, repérer
 * les lacunes, recommander un parcours, éviter de faire refaire
 * inutilement les notions maîtrisées ». Document global §11 : le
 * parcours adaptatif commence par un test initial qui attribue un
 * niveau initial à chaque compétence.
 *
 * Un test de positionnement est un QCM ordinaire marqué
 * `activities.content.placement = true`. Ce qui le distingue :
 *
 * - il est proposé AVANT les leçons (bandeau du lecteur de cours) ;
 * - il ne rapporte ni XP ni badge : il mesure, il ne récompense pas ;
 * - son bilan est rendu COMPÉTENCE PAR COMPÉTENCE, avec une
 *   recommandation de parcours, et pas seulement un score global ;
 * - il compte comme une preuve parmi d'autres pour la maîtrise
 *   (document global §10 : « plusieurs preuves : test de
 *   positionnement, résultats aux activités… »), mais n'attribue
 *   jamais le niveau Elite.
 */

import type { CorrectionQuestion } from "@/lib/courses/progression";

/** L'activité est-elle un test de positionnement ? */
export function estTestDePositionnement(content: unknown): boolean {
  return Boolean(
    content && typeof content === "object" && (content as { placement?: unknown }).placement === true
  );
}

export type Verdict = "acquis" | "a_consolider" | "prioritaire";

export const VERDICT_LABELS: Record<Verdict, string> = {
  acquis: "Déjà acquis",
  a_consolider: "À consolider",
  prioritaire: "À travailler en priorité",
};

export const VERDICT_CONSEILS: Record<Verdict, string> = {
  acquis:
    "Vous maîtrisez déjà l'essentiel : parcourez les leçons liées rapidement et concentrez-vous sur les exercices.",
  a_consolider:
    "Les bases sont là, mais pas toutes : suivez les leçons liées à votre rythme et retentez les QCM.",
  prioritaire:
    "Commencez par les leçons liées à cette compétence : c'est là que la formation vous apportera le plus.",
};

export interface BilanCompetence {
  competencyId: string;
  nbQuestions: number;
  nbCorrectes: number;
  pourcent: number;
  verdict: Verdict;
}

/**
 * Seuils du verdict, alignés sur les niveaux du dossier fonctionnel
 * (§4.2 : Fondamentaux 60 %, Opérationnel 80 %) : à 80 % ou plus la
 * compétence est tenue pour acquise au niveau Opérationnel visé par
 * la plupart des formations ; entre 60 et 79 %, les fondamentaux sont
 * là ; en dessous, la compétence est prioritaire.
 */
export function verdictPour(pourcent: number): Verdict {
  if (pourcent >= 80) return "acquis";
  if (pourcent >= 60) return "a_consolider";
  return "prioritaire";
}

/**
 * Bilan par compétence d'un test de positionnement corrigé.
 *
 * `competenceParQuestion` relie chaque question à sa compétence ;
 * une question sans compétence est ignorée du bilan (elle compte
 * dans le score global, pas dans l'analyse). Les compétences sont
 * rendues des plus faibles aux plus fortes : la première ligne est
 * celle par laquelle commencer.
 */
export function bilanPositionnement(
  details: Array<Pick<CorrectionQuestion, "questionId" | "correcte">>,
  competenceParQuestion: Record<string, string | null | undefined>
): BilanCompetence[] {
  const parCompetence = new Map<string, { nb: number; ok: number }>();
  for (const d of details) {
    const competencyId = competenceParQuestion[d.questionId];
    if (!competencyId) continue;
    // Une question ouverte pas encore notée (lot 23) n'est pas une preuve.
    if (d.correcte === null) continue;
    const c = parCompetence.get(competencyId) ?? { nb: 0, ok: 0 };
    c.nb += 1;
    if (d.correcte) c.ok += 1;
    parCompetence.set(competencyId, c);
  }
  return [...parCompetence.entries()]
    .map(([competencyId, c]) => {
      const pourcent = Math.round((c.ok / c.nb) * 100);
      return {
        competencyId,
        nbQuestions: c.nb,
        nbCorrectes: c.ok,
        pourcent,
        verdict: verdictPour(pourcent),
      };
    })
    .sort((a, b) => a.pourcent - b.pourcent || a.competencyId.localeCompare(b.competencyId));
}

/**
 * Le test est-il « à faire » ? Une seule passation suffit : on ne
 * relance pas un apprenant qui l'a déjà fait, même avec un score bas —
 * c'est précisément l'information recherchée.
 */
export function positionnementAFaire(
  activitesPlacement: Array<{ id: string }>,
  activitesTentees: Iterable<string>
): { id: string } | null {
  const tentees = new Set(activitesTentees);
  return activitesPlacement.find((a) => !tentees.has(a.id)) ?? null;
}

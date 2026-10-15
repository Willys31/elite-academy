import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  meilleursScoresParActivite,
  niveauDepuisScores,
  scorePourCompetence,
} from "@/lib/courses/progression";

/**
 * Mise à jour de la maîtrise par compétence après une tentative –
 * côté serveur uniquement.
 *
 * Ce bloc vivait dans `soumettreQcm`. Depuis le lot 23 il sert aussi
 * quand un formateur note une question ouverte : la tentative, jusque-là
 * en attente, devient une preuve et la maîtrise doit être recalculée.
 * Deux appelants, une seule règle.
 *
 * Tout se lit et s'écrit par le client d'administration : `progress_records`
 * n'a plus de politique d'écriture utilisateur (migration 0019), et le
 * correcteur n'a pas forcément le droit de lire les tentatives de
 * l'apprenant sous sa propre RLS. Les appelants ont vérifié avant :
 * l'apprenant soumet sa propre tentative sur une activité visible, le
 * correcteur encadre la formation (`oversees_activity`).
 */

/** Rang numérique des niveaux de maîtrise, pour détecter une montée. */
const RANG_MAITRISE: Record<string, number> = {
  fundamentals: 1,
  operational: 2,
  advanced: 3,
  elite: 4,
};

export async function mettreAJourMaitrise(params: {
  admin: SupabaseClient;
  userId: string;
  courseId: string;
  activityId: string;
  /** Test de positionnement : la première passation est tracée comme niveau initial. */
  placement: boolean;
  /** Score global de la tentative qui déclenche le recalcul (`null` si en attente). */
  scoreTentative: number | null;
}): Promise<string[]> {
  const { admin, userId, courseId, activityId, placement, scoreTentative } = params;
  if (!courseId) return [];

  // Mise à jour de la maîtrise pour chaque compétence liée à l'activité.
  const { data: liens } = await admin
    .from("activity_competencies")
    .select("competency_id")
    .eq("activity_id", activityId);

  const competencesMontees: string[] = [];
  for (const lien of liens ?? []) {
    // Activités liées à la même compétence.
    const { data: activitesLiees } = await admin
      .from("activity_competencies")
      .select("activity_id")
      .eq("competency_id", lien.competency_id);
    const ids = (activitesLiees ?? []).map((a) => a.activity_id);
    if (ids.length === 0) continue;

    /* Score PAR COMPÉTENCE : seules les questions rattachées à la
       compétence comptent (document global §23 : « ne pas confondre note
       globale et maîtrise réelle ») ; à défaut, le score global de la
       tentative. Une question ouverte pas encore notée ne compte pas. */
    const [{ data: tentatives }, { data: questionsLiees }] = await Promise.all([
      admin
        .from("attempts")
        .select("activity_id, score, feedback")
        .eq("user_id", userId)
        .in("activity_id", ids),
      admin.from("questions").select("id, competency_id").in("activity_id", ids),
    ]);
    const competenceParQuestion: Record<string, string | null> = {};
    for (const q of questionsLiees ?? []) {
      competenceParQuestion[q.id] = (q.competency_id as string | null) ?? null;
    }

    const scores = meilleursScoresParActivite(
      (tentatives ?? []).map((t) => ({
        activityId: t.activity_id,
        score: scorePourCompetence(
          { score: t.score === null ? null : Number(t.score), feedback: t.feedback },
          lien.competency_id,
          competenceParQuestion
        ),
      }))
    );
    const niveau = niveauDepuisScores(scores);
    const moyenne =
      scores.length > 0
        ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
        : null;

    const { data: progres } = await admin
      .from("progress_records")
      .select("id, mastery_level")
      .eq("user_id", userId)
      .eq("course_id", courseId)
      .eq("competency_id", lien.competency_id)
      .maybeSingle();

    // Une montée de niveau (jamais le niveau Elite, réservé à la
    // validation humaine) vaut un badge Progression et 100 XP.
    const rangAvant = progres?.mastery_level ? (RANG_MAITRISE[progres.mastery_level] ?? 0) : 0;
    const rangApres = niveau ? (RANG_MAITRISE[niveau] ?? 0) : 0;
    if (rangApres > rangAvant && rangAvant < 4) competencesMontees.push(lien.competency_id);

    const valeurs = {
      mastery_level: niveau,
      score: moyenne,
      evidence:
        placement && !progres
          ? {
              activites: scores.length,
              source: "positionnement",
              initial: { score: scoreTentative, date: new Date().toISOString() },
            }
          : { activites: scores.length, source: placement ? "positionnement" : "qcm" },
      updated_at: new Date().toISOString(),
    };
    if (progres) {
      await admin.from("progress_records").update(valeurs).eq("id", progres.id);
    } else {
      await admin.from("progress_records").insert({
        user_id: userId,
        course_id: courseId,
        competency_id: lien.competency_id,
        ...valeurs,
      });
    }
  }
  return competencesMontees;
}

/**
 * Formation d'une activité (version → module → leçon), avec son
 * organisation. `null` si l'activité est orpheline.
 */
export async function formationDeLActivite(
  admin: SupabaseClient,
  activityId: string
): Promise<{ id: string; organization_id: string; difficulty: number } | null> {
  const { data: activite } = await admin
    .from("activities")
    /* Clé étrangère explicite : deux relations existent entre versions et
       formations ; sans elle PostgREST répond PGRST201. */
    .select(
      "difficulty, lesson:lessons(module:modules(version:course_versions(course:courses!course_versions_course_id_fkey(id, organization_id))))"
    )
    .eq("id", activityId)
    .maybeSingle();
  const premier = <T,>(v: T | T[] | null | undefined): T | null =>
    Array.isArray(v) ? (v[0] ?? null) : (v ?? null);
  const cours = premier(premier(premier(premier(activite?.lesson)?.module)?.version)?.course) as
    | { id: string; organization_id: string }
    | null;
  if (!cours) return null;
  return { id: cours.id, organization_id: cours.organization_id, difficulty: Number(activite?.difficulty ?? 1) };
}

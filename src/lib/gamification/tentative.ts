import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { calculerXpQcm, serieBonnesReponses, XP_FIXES } from "@/lib/gamification/xp";
import {
  attribuerXp,
  decernerBadge,
  fixerCompteurs,
  incrementerCompteurs,
  mettreAJourSerie,
  recalculerMaitriseCompteurs,
  verifierBadges,
} from "@/lib/gamification/moteur";
import { formationDeLActivite } from "@/lib/courses/maitrise";

/**
 * Points, compteurs et badges d'une tentative notée. Tout est
 * idempotent par référence de tentative ; une panne ici n'annule
 * jamais la correction.
 *
 * Appelé à la soumission d'une tentative corrigée automatiquement, et,
 * depuis le lot 23, quand un formateur note une tentative restée en
 * attente : l'apprenant reçoit alors ses points, sans bonus de rapidité
 * (la durée n'a plus de sens une fois la copie passée par un humain).
 */
export async function gamifierTentative(params: {
  admin: SupabaseClient;
  userId: string;
  courseId: string;
  activityId: string;
  sessionId: string | null;
  attemptId: string;
  scorePourcent: number;
  nbQuestions: number;
  dureeSecondes: number | null;
  scoresPrecedents: Array<{ score: number | null }>;
  meilleurAvant: number | null;
  competencesMontees: string[];
}): Promise<number> {
  const { admin, userId, courseId, activityId } = params;

  // Organisation : celle de l'activité (via la formation), sinon celle
  // de l'inscription — une session d'atelier peut se passer d'inscription.
  const [coursActivite, { data: inscription }] = await Promise.all([
    formationDeLActivite(admin, activityId),
    courseId
      ? admin
          .from("enrollments")
          .select("organization_id")
          .eq("course_id", courseId)
          .eq("user_id", userId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const organizationId = coursActivite?.organization_id ?? inscription?.organization_id ?? null;
  if (!organizationId) return 0;
  const courseIdEffectif = courseId || coursActivite?.id || null;

  const xp = calculerXpQcm({
    scorePourcent: params.scorePourcent,
    difficulte: coursActivite?.difficulty ?? 1,
    nbQuestions: params.nbQuestions,
    dureeSecondes: params.dureeSecondes,
    serieAvant: serieBonnesReponses(params.scoresPrecedents),
  });

  let total = await attribuerXp({
    userId,
    organizationId,
    type: "qcm",
    montant: xp.total,
    referenceId: params.attemptId,
    courseId: courseIdEffectif,
    activityId,
    sessionId: params.sessionId,
    details: { ...xp, duree_secondes: params.dureeSecondes, score: params.scorePourcent },
  });

  // En session : participation à l'activité (plafond 10 par session).
  if (params.sessionId) {
    const { count } = await admin
      .from("xp_events")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("session_id", params.sessionId)
      .eq("xp_type", "session_activite");
    if ((count ?? 0) < 10) {
      total += await attribuerXp({
        userId,
        organizationId,
        type: "session_activite",
        montant: XP_FIXES.session_activite,
        referenceId: params.attemptId,
        courseId: courseIdEffectif,
        activityId,
        sessionId: params.sessionId,
      });
    }
  }

  // Compteurs de performance.
  const increments: Record<string, number> = {};
  if (xp.rapiditeActivee) increments.reflexe = 1;
  if (params.scorePourcent === 100) increments.sans_faute = 1;
  await incrementerCompteurs(userId, increments);

  // Compétences dont la moyenne des meilleurs scores atteint 90 %
  // (`progress_records.score` est cette moyenne), puis niveaux de maîtrise.
  const { data: progres } = await admin
    .from("progress_records")
    .select("score")
    .eq("user_id", userId)
    .not("competency_id", "is", null);
  const expertes = (progres ?? []).filter((p) => p.score !== null && Number(p.score) >= 90).length;
  await fixerCompteurs(userId, { expert_competences: expertes });
  await recalculerMaitriseCompteurs(userId);

  // Badges événementiels.
  for (const competencyId of params.competencesMontees) {
    await decernerBadge(userId, organizationId, "progression", competencyId, {
      course_id: courseIdEffectif,
    });
    total += await attribuerXp({
      userId,
      organizationId,
      type: "niveau_competence",
      montant: XP_FIXES.niveau_competence,
      referenceId: competencyId,
      courseId: courseIdEffectif,
      details: { attempt_id: params.attemptId },
    });
  }
  if (params.meilleurAvant !== null && params.meilleurAvant < 50 && params.scorePourcent > 80) {
    await decernerBadge(userId, organizationId, "comeback", activityId, {
      course_id: courseIdEffectif,
      de: params.meilleurAvant,
      a: params.scorePourcent,
    });
  }

  await mettreAJourSerie(userId, organizationId);
  await verifierBadges(userId, organizationId);
  return total;
}

/**
 * Tentatives précédentes de l'apprenant sur l'activité (au plus dix,
 * de la plus ancienne à la plus récente), pour la série de bonnes
 * réponses et le badge Comeback. Les tentatives en attente de
 * correction (score `null`) sont neutres.
 */
export async function tentativesPrecedentes(
  admin: SupabaseClient,
  userId: string,
  activityId: string,
  /** Tentative à exclure (celle que l'on est en train de noter). */
  sauf?: string
): Promise<{ scoresPrecedents: Array<{ score: number | null }>; meilleurAvant: number | null }> {
  const { data } = await admin
    .from("attempts")
    .select("id, score, submitted_at")
    .eq("activity_id", activityId)
    .eq("user_id", userId)
    .order("submitted_at", { ascending: true })
    .limit(11);
  const lignes = (data ?? []).filter((t) => t.id !== sauf).slice(-10);
  const scoresPrecedents = lignes.map((t) => ({
    score: t.score === null ? null : Number(t.score),
  }));
  const meilleurAvant = scoresPrecedents.reduce<number | null>(
    (m, t) => (t.score !== null && (m === null || t.score > m) ? t.score : m),
    null
  );
  return { scoresPrecedents, meilleurAvant };
}

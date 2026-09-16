"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/profile";
import {
  calculerCompletion,
  corrigerQcm,
  meilleursScoresParActivite,
  niveauDepuisScores,
  type QuestionQcm,
} from "@/lib/courses/progression";
import { peutSeDesinscrire } from "@/lib/courses/inscriptions";
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
import type { ActionState } from "@/app/(app)/catalogue/actions";

/** Rang numérique des niveaux de maîtrise, pour détecter une montée. */
const RANG_MAITRISE: Record<string, number> = {
  fundamentals: 1,
  operational: 2,
  advanced: 3,
  elite: 4,
};

function loguer(contexte: string, error: { message?: string } | null) {
  if (error) console.error(`[formations] ${contexte} :`, error.message ?? error);
}

// ------------------------------------------------------------
// Inscription à une formation publiée
// ------------------------------------------------------------

export async function sInscrireFormation(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await getCurrentUser();
  if (!user) return { error: "Vous devez être connecté." };

  const courseId = String(formData.get("course_id") ?? "");
  const supabase = await createClient();

  const { data: course } = await supabase
    .from("courses")
    .select("id, organization_id, status")
    .eq("id", courseId)
    .maybeSingle();

  if (!course) return { error: "Formation introuvable ou non autorisée." };
  if (course.status !== "published") {
    return { error: "Cette formation n'est pas encore publiée." };
  }

  // `unique (course_id, user_id)` interdit une seconde inscription : un
  // apprenant qui revient réactive donc sa ligne retirée, et retrouve
  // du même coup la progression qui y était restée attachée.
  const { data: existante } = await supabase
    .from("enrollments")
    .select("id, status")
    .eq("course_id", course.id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (existante) {
    if (existante.status === "suspended") {
      return {
        error:
          "Votre inscription à cette formation a été suspendue par l'encadrement. Contactez votre responsable pour la réactiver.",
      };
    }
    if (existante.status !== "withdrawn") {
      return { error: "Vous êtes déjà inscrit à cette formation." };
    }

    // `started_at` d'origine conservé : c'est une reprise, pas un
    // nouveau départ.
    const { error, count } = await supabase
      .from("enrollments")
      .update({ status: "active" }, { count: "exact" })
      .eq("id", existante.id)
      .eq("user_id", user.id)
      .eq("status", "withdrawn");
    if (error) {
      loguer("réinscription", error);
      return { error: "La réinscription a échoué. Réessayez plus tard." };
    }
    if (count === 0) {
      return {
        error:
          "La réinscription n'a pas pu être enregistrée : votre inscription a peut-être changé entre-temps. Rechargez la page.",
      };
    }
  } else {
    const { error } = await supabase.from("enrollments").insert({
      course_id: course.id,
      user_id: user.id,
      organization_id: course.organization_id,
      status: "active",
      started_at: new Date().toISOString(),
    });

    if (error) {
      // Deux envois simultanés : le second heurte la contrainte d'unicité.
      if (error.code === "23505") {
        return { error: "Vous êtes déjà inscrit à cette formation." };
      }
      loguer("inscription", error);
      return { error: "L'inscription a échoué. Réessayez plus tard." };
    }
  }

  revalidatePath(`/catalogue/${course.id}`);
  revalidatePath("/formations");
  redirect(`/formations/${course.id}`);
}

// ------------------------------------------------------------
// Désinscription d'une formation en cours
// ------------------------------------------------------------

/**
 * Retire l'apprenant d'une formation en cours.
 *
 * L'inscription passe au statut `withdrawn`, elle n'est pas supprimée :
 * les leçons terminées (`progress_records`) et les tentatives de QCM
 * (`attempts`, non supprimables par conception) restent en place, si
 * bien qu'une réinscription reprend là où l'apprenant s'était arrêté.
 * Aucune migration n'est nécessaire : la politique `enrollments_update`
 * autorise déjà l'apprenant à modifier sa propre inscription.
 *
 * Les règles (formations en cours uniquement, pas de retrait d'un
 * parcours attribué) vivent dans `peutSeDesinscrire`.
 */
export async function seDesinscrireFormation(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await getCurrentUser();
  if (!user) return { error: "Vous devez être connecté." };

  const courseId = String(formData.get("course_id") ?? "");
  const supabase = await createClient();

  const { data: inscription } = await supabase
    .from("enrollments")
    .select("id, status, assigned_by")
    .eq("course_id", courseId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!inscription) return { error: "Vous n'êtes pas inscrit à cette formation." };

  const verdict = peutSeDesinscrire({
    statut: inscription.status,
    assigneePar: inscription.assigned_by,
  });
  if (!verdict.ok) return { error: verdict.raison };

  // Filtre sur `status = active` : si l'inscription a changé entre la
  // lecture et l'écriture (leçon terminée dans un autre onglet), rien
  // n'est modifié plutôt que d'écraser un statut `completed`.
  const { error, count } = await supabase
    .from("enrollments")
    .update({ status: "withdrawn" }, { count: "exact" })
    .eq("id", inscription.id)
    .eq("user_id", user.id)
    .eq("status", "active");

  if (error) {
    loguer("désinscription", error);
    return { error: "La désinscription a échoué. Réessayez plus tard." };
  }
  // RLS ne renvoie pas d'erreur quand aucune ligne n'est visible : sans
  // ce contrôle, un refus passerait pour un succès.
  if (count === 0) {
    return {
      error:
        "La désinscription n'a pas pu être enregistrée : votre inscription a peut-être changé entre-temps. Rechargez la page.",
    };
  }

  revalidatePath("/formations");
  revalidatePath(`/formations/${courseId}`);
  revalidatePath(`/catalogue/${courseId}`);
  redirect("/formations?desinscrit=1");
}

// ------------------------------------------------------------
// Marquer une leçon comme terminée
// ------------------------------------------------------------

/** Identifiants des leçons de la version courante d'une formation. */
async function leconsDeLaFormation(
  supabase: Awaited<ReturnType<typeof createClient>>,
  courseId: string
): Promise<string[]> {
  const { data: course } = await supabase
    .from("courses")
    .select("current_version_id")
    .eq("id", courseId)
    .maybeSingle();
  if (!course?.current_version_id) return [];

  const { data: modules } = await supabase
    .from("modules")
    .select("id")
    .eq("course_version_id", course.current_version_id);
  const moduleIds = (modules ?? []).map((m) => m.id);
  if (moduleIds.length === 0) return [];

  const { data: lessons } = await supabase
    .from("lessons")
    .select("id")
    .in("module_id", moduleIds);
  return (lessons ?? []).map((l) => l.id);
}

export async function marquerLeconTerminee(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await getCurrentUser();
  if (!user) return { error: "Vous devez être connecté." };

  const courseId = String(formData.get("course_id") ?? "");
  const lessonId = String(formData.get("lesson_id") ?? "");
  const supabase = await createClient();

  // Enregistrer (ou confirmer) la leçon terminée.
  const { data: existant } = await supabase
    .from("progress_records")
    .select("id")
    .eq("user_id", user.id)
    .eq("lesson_id", lessonId)
    .maybeSingle();

  let xpGagne = 0;
  if (!existant) {
    const { error } = await supabase.from("progress_records").insert({
      user_id: user.id,
      course_id: courseId,
      lesson_id: lessonId,
      completion_percent: 100,
    });
    if (error) {
      loguer("leçon terminée", error);
      return { error: "L'enregistrement a échoué. Réessayez." };
    }

    // Gamification : la première fois seulement (référence = leçon).
    const { data: inscription } = await supabase
      .from("enrollments")
      .select("organization_id")
      .eq("course_id", courseId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (inscription) {
      xpGagne = await attribuerXp({
        userId: user.id,
        organizationId: inscription.organization_id,
        type: "lecon_terminee",
        montant: XP_FIXES.lecon_terminee,
        referenceId: lessonId,
        courseId,
      });
      await mettreAJourSerie(user.id, inscription.organization_id);
      await verifierBadges(user.id, inscription.organization_id);
    }
  }

  // Mettre à jour la complétion de l'inscription.
  const toutes = await leconsDeLaFormation(supabase, courseId);
  const { data: faites } = await supabase
    .from("progress_records")
    .select("lesson_id")
    .eq("user_id", user.id)
    .eq("course_id", courseId)
    .not("lesson_id", "is", null);

  const completion = calculerCompletion(
    (faites ?? []).filter((f) => toutes.includes(f.lesson_id as string)).length,
    toutes.length
  );
  if (completion === 100) {
    await supabase
      .from("enrollments")
      .update({ status: "completed", completed_at: new Date().toISOString() })
      .eq("course_id", courseId)
      .eq("user_id", user.id)
      .eq("status", "active");
  }

  revalidatePath(`/formations/${courseId}`);
  return {
    success: xpGagne > 0 ? `Leçon marquée comme terminée. +${xpGagne} XP` : "Leçon marquée comme terminée.",
  };
}

// ------------------------------------------------------------
// Soumission d'un QCM : correction serveur, tentative, progression
// ------------------------------------------------------------

export async function soumettreQcm(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await getCurrentUser();
  if (!user) return { error: "Vous devez être connecté." };

  const courseId = String(formData.get("course_id") ?? "");
  const activityId = String(formData.get("activity_id") ?? "");
  const sessionId = String(formData.get("session_id") ?? "");
  /* Horodatage de l'affichage, posé par le serveur dans un champ caché.
     Il sert uniquement au bonus de rapidité : une valeur absente ou
     manipulée ne fait perdre que ce bonus, jamais la correction. */
  const affichageMs = parseInt(String(formData.get("started_at") ?? ""), 10);
  const dureeSecondes =
    Number.isFinite(affichageMs) && affichageMs > 0
      ? Math.round((Date.now() - affichageMs) / 1000)
      : null;
  const supabase = await createClient();

  // Les bonnes réponses ne quittent jamais le serveur avant soumission.
  const { data: questionsBrutes, error: erreurQuestions } = await supabase
    .from("questions")
    .select("id, prompt, options, expected_answer, explanation, competency_id")
    .eq("activity_id", activityId)
    .order("position");

  if (erreurQuestions || !questionsBrutes || questionsBrutes.length === 0) {
    return { error: "Ce QCM est introuvable ou ne contient aucune question." };
  }

  const questions: QuestionQcm[] = questionsBrutes.map((q) => ({
    id: q.id,
    prompt: q.prompt,
    options: (q.options as string[]) ?? [],
    bonneReponse: Number((q.expected_answer as { index?: number })?.index ?? -1),
    explication: q.explanation,
    competencyId: q.competency_id,
  }));

  const reponses: Record<string, number> = {};
  for (const q of questions) {
    const valeur = formData.get(`q_${q.id}`);
    if (valeur !== null) reponses[q.id] = parseInt(String(valeur), 10);
  }
  if (Object.keys(reponses).length === 0) {
    return { error: "Répondez à au moins une question avant de soumettre." };
  }

  const correction = corrigerQcm(questions, reponses);

  // Tentatives précédentes : série de bonnes réponses et meilleur score
  // avant celle-ci (pour l'XP et le badge Comeback).
  const { data: precedentes } = await supabase
    .from("attempts")
    .select("score, submitted_at")
    .eq("activity_id", activityId)
    .eq("user_id", user.id)
    .order("submitted_at", { ascending: true })
    .limit(10);
  const scoresPrecedents = (precedentes ?? []).map((t) => ({
    score: t.score === null ? null : Number(t.score),
  }));
  const meilleurAvant = scoresPrecedents.reduce<number | null>(
    (m, t) => (t.score !== null && (m === null || t.score > m) ? t.score : m),
    null
  );

  const { data: tentative, error: erreurTentative } = await supabase
    .from("attempts")
    .insert({
      activity_id: activityId,
      user_id: user.id,
      session_id: sessionId || null,
      answers: reponses,
      score: correction.scorePourcent,
      feedback: correction as unknown as Record<string, unknown>,
      status: "graded",
      submitted_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (erreurTentative || !tentative) {
    loguer("enregistrement de la tentative", erreurTentative);
    return { error: "La tentative n'a pas pu être enregistrée. Réessayez." };
  }

  // En session présentielle : signaler la réponse au formateur en direct.
  if (sessionId) {
    const { error: erreurEvenement } = await supabase.from("live_events").insert({
      session_id: sessionId,
      type: "attempt_submitted",
      payload: { activity_id: activityId, score: correction.scorePourcent },
      created_by: user.id,
    });
    loguer("événement de session", erreurEvenement);
    revalidatePath(`/sessions/${sessionId}`);
    revalidatePath(`/sessions/${sessionId}/activite/${activityId}`);
  }

  // Mise à jour de la maîtrise pour chaque compétence liée à l'activité.
  // (uniquement si l'activité est rattachée à une formation connue)
  const { data: liens } = courseId
    ? await supabase
        .from("activity_competencies")
        .select("competency_id")
        .eq("activity_id", activityId)
    : { data: [] };

  const competencesMontees: string[] = [];
  for (const lien of liens ?? []) {
    // Activités de cette formation liées à la même compétence.
    const { data: activitesLiees } = await supabase
      .from("activity_competencies")
      .select("activity_id")
      .eq("competency_id", lien.competency_id);
    const ids = (activitesLiees ?? []).map((a) => a.activity_id);
    if (ids.length === 0) continue;

    const { data: tentatives } = await supabase
      .from("attempts")
      .select("activity_id, score")
      .eq("user_id", user.id)
      .in("activity_id", ids);

    const scores = meilleursScoresParActivite(
      (tentatives ?? []).map((t) => ({
        activityId: t.activity_id,
        score: t.score === null ? null : Number(t.score),
      }))
    );
    const niveau = niveauDepuisScores(scores);
    const moyenne =
      scores.length > 0
        ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
        : null;

    const { data: progres } = await supabase
      .from("progress_records")
      .select("id, mastery_level")
      .eq("user_id", user.id)
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
      evidence: { activites: scores.length, source: "qcm" },
      updated_at: new Date().toISOString(),
    };
    if (progres) {
      await supabase.from("progress_records").update(valeurs).eq("id", progres.id);
    } else {
      await supabase.from("progress_records").insert({
        user_id: user.id,
        course_id: courseId,
        competency_id: lien.competency_id,
        ...valeurs,
      });
    }
  }

  // ---------- Gamification (lot 14) ----------
  const xpGagne = await gamifierTentative({
    supabase,
    userId: user.id,
    courseId,
    activityId,
    sessionId: sessionId || null,
    attemptId: tentative.id as string,
    scorePourcent: correction.scorePourcent,
    nbQuestions: questions.length,
    dureeSecondes,
    scoresPrecedents,
    meilleurAvant,
    competencesMontees,
  });

  revalidatePath(`/formations/${courseId}/activite/${activityId}`);
  revalidatePath("/progression");
  revalidatePath("/badges");
  return {
    success: `Score : ${correction.scorePourcent} % (${correction.nbCorrectes}/${correction.nbQuestions}).${
      xpGagne > 0 ? ` +${xpGagne} XP.` : ""
    } Le détail corrigé s'affiche ci-dessous.`,
  };
}

/**
 * Points, compteurs et badges d'une tentative. Tout est idempotent par
 * référence de tentative ; une panne ici n'annule jamais la correction.
 */
async function gamifierTentative(params: {
  supabase: Awaited<ReturnType<typeof createClient>>;
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
  const { supabase, userId, courseId, activityId } = params;

  // Organisation : celle de l'activité (via la formation), sinon celle
  // de l'inscription — une session d'atelier peut se passer d'inscription.
  const [{ data: activite }, { data: inscription }] = await Promise.all([
    supabase
      .from("activities")
      .select("difficulty, lesson:lessons(module:modules(version:course_versions(course:courses(id, organization_id))))")
      .eq("id", activityId)
      .maybeSingle(),
    courseId
      ? supabase
          .from("enrollments")
          .select("organization_id")
          .eq("course_id", courseId)
          .eq("user_id", userId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const premier = <T,>(v: T | T[] | null | undefined): T | null =>
    Array.isArray(v) ? (v[0] ?? null) : (v ?? null);
  const coursActivite = premier(premier(premier(premier(activite?.lesson)?.module)?.version)?.course) as
    | { id: string; organization_id: string }
    | null;
  const organizationId = coursActivite?.organization_id ?? inscription?.organization_id ?? null;
  if (!organizationId) return 0;
  const courseIdEffectif = courseId || coursActivite?.id || null;

  const xp = calculerXpQcm({
    scorePourcent: params.scorePourcent,
    difficulte: Number(activite?.difficulty ?? 1),
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
    const { count } = await supabase
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
  const { data: progres } = await supabase
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

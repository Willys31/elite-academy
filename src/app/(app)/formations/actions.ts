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
import type { ActionState } from "@/app/(app)/catalogue/actions";

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

  const { error } = await supabase.from("enrollments").insert({
    course_id: course.id,
    user_id: user.id,
    organization_id: course.organization_id,
    status: "active",
    started_at: new Date().toISOString(),
  });

  if (error) {
    if (error.code === "23505") {
      return { error: "Vous êtes déjà inscrit à cette formation." };
    }
    loguer("inscription", error);
    return { error: "L'inscription a échoué. Réessayez plus tard." };
  }

  revalidatePath(`/catalogue/${course.id}`);
  redirect(`/formations/${course.id}`);
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
  return { success: "Leçon marquée comme terminée." };
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

  const { error: erreurTentative } = await supabase.from("attempts").insert({
    activity_id: activityId,
    user_id: user.id,
    session_id: sessionId || null,
    answers: reponses,
    score: correction.scorePourcent,
    feedback: correction as unknown as Record<string, unknown>,
    status: "graded",
    submitted_at: new Date().toISOString(),
  });
  if (erreurTentative) {
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
      .select("id")
      .eq("user_id", user.id)
      .eq("course_id", courseId)
      .eq("competency_id", lien.competency_id)
      .maybeSingle();

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

  revalidatePath(`/formations/${courseId}/activite/${activityId}`);
  revalidatePath("/progression");
  return {
    success: `Score : ${correction.scorePourcent} % (${correction.nbCorrectes}/${correction.nbQuestions}). Le détail corrigé s'affiche ci-dessous.`,
  };
}

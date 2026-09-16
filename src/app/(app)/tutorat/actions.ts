"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth/profile";
import { appelerLlm, iaConfiguree, modeleConfigure, modeSimulation } from "@/lib/ai/client";
import {
  construirePromptAide,
  construirePromptExercices,
  PROMPT_VERSION_EXERCICES,
  PROMPT_VERSION_TUTEUR,
  SYSTEM_EXERCICES,
  SYSTEM_TUTEUR,
} from "@/lib/ai/prompts";
import { extraireJson } from "@/lib/ai/schema";
import { simulerAide, simulerExercices } from "@/lib/ai/simulation";
import type { ResultatCorrection } from "@/lib/courses/progression";
import {
  aideAutorisee,
  bandeDeBlocage,
  peutDemanderAide,
  peutGenerer,
  typeAideValide,
  typeExerciceRecommande,
  xpExercice,
  type TypeExercice,
} from "@/lib/tutorat/blocage";
import {
  corrigerExercice,
  lireReponsesExercice,
  separerSolution,
  validerExercicesGeneres,
  type ContenuExercice,
  type SolutionExercice,
} from "@/lib/tutorat/exercices";
import { compterExercicePerso, generationsDuJour, recalculerScoreBlocage } from "@/lib/tutorat/moteur";
import { attribuerXp, verifierBadges } from "@/lib/gamification/moteur";
import { emettreNotification } from "@/lib/notifications/emettre";
import type { ActionState } from "@/app/(app)/catalogue/actions";

/**
 * Actions du tutorat IA (addendum Tutorat §3, §5).
 *
 * Confidentialité des corrections : `expected_answer` et `explanation`
 * ne sont lus que pour l'explication détaillée, et seulement si une
 * tentative existe ; les quatre autres aides ne voient que l'énoncé et
 * les options. La solution des exercices personnalisés vit dans une
 * table sans aucune politique de lecture, lue par le client
 * d'administration au moment de corriger.
 */

function loguer(operation: string, erreur: unknown) {
  if (erreur) console.error(`[tutorat] ${operation}`, erreur);
}

const premier = <T,>(v: T | T[] | null | undefined): T | null =>
  Array.isArray(v) ? (v[0] ?? null) : (v ?? null);

/** Formation, organisation et compétences d'une activité (via la leçon). */
async function contexteActivite(
  supabase: Awaited<ReturnType<typeof createClient>>,
  activityId: string
) {
  const { data } = await supabase
    .from("activities")
    .select(
      "id, title, lesson:lessons(content, module:modules(version:course_versions(course:courses(id, title, organization_id, sector)))), activity_competencies(competency:competencies(id, name))"
    )
    .eq("id", activityId)
    .maybeSingle();
  if (!data) return null;
  const lecon = premier(data.lesson);
  const course = premier(premier(premier(lecon?.module)?.version)?.course) as
    | { id: string; title: string; organization_id: string; sector: string | null }
    | null;
  if (!course) return null;
  const competences = ((data.activity_competencies ?? []) as Array<{ competency: unknown }>)
    .map((ac) => premier(ac.competency) as { id: string; name: string } | null)
    .filter((c): c is { id: string; name: string } => Boolean(c));
  const texte = ((lecon?.content ?? {}) as { text?: string }).text ?? "";
  return { activite: { id: data.id as string, title: data.title as string }, course, competences, extraitLecon: texte.slice(0, 1500) };
}

// ------------------------------------------------------------
// Boutons d'aide
// ------------------------------------------------------------

export async function demanderAide(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await getCurrentUser();
  if (!user) return { error: "Vous devez être connecté." };

  const activityId = String(formData.get("activity_id") ?? "");
  const questionId = String(formData.get("question_id") ?? "");
  const type = String(formData.get("help_type") ?? "");
  if (!activityId || !questionId) return { error: "Choisissez la question qui vous bloque." };
  if (!typeAideValide(type)) return { error: "Type d'aide inconnu." };
  if (!iaConfiguree() && !modeSimulation()) {
    return { error: "Le tuteur IA n'est pas configuré sur cette installation (voir .env.example)." };
  }

  const dejaAujourdhui = await generationsDuJour(user.id, ["tutor_help"]);
  if (!peutDemanderAide(dejaAujourdhui)) {
    return { error: "Vous avez atteint la limite de 30 aides par jour. Partagez votre blocage dans l'Entraide ou revenez demain." };
  }

  const supabase = await createClient();
  const ctx = await contexteActivite(supabase, activityId);
  if (!ctx) return { error: "Activité introuvable." };

  // Une tentative existe-t-elle ? (nécessaire pour l'explication détaillée)
  const { data: derniere } = await supabase
    .from("attempts")
    .select("id, answers")
    .eq("activity_id", activityId)
    .eq("user_id", user.id)
    .order("submitted_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!aideAutorisee(type, Boolean(derniere))) {
    return { error: "L'explication détaillée n'est disponible qu'après une première tentative : essayez d'abord de répondre." };
  }

  // Énoncé et options ; la correction seulement si elle est autorisée.
  const colonnes = type === "detailed_explanation" ? "id, prompt, options, competency_id, expected_answer, explanation" : "id, prompt, options, competency_id";
  const { data: question } = await supabase.from("questions").select(colonnes).eq("id", questionId).eq("activity_id", activityId).maybeSingle();
  if (!question) return { error: "Question introuvable." };
  const q = question as unknown as {
    id: string;
    prompt: string;
    options: string[];
    competency_id: string | null;
    expected_answer?: { index?: number } | null;
    explanation?: string | null;
  };
  const competencyId = q.competency_id ?? ctx.competences[0]?.id ?? null;
  const competenceNom = ctx.competences.find((c) => c.id === competencyId)?.name ?? null;

  const tentative =
    type === "detailed_explanation" && derniere
      ? {
          reponseDonnee: (() => {
            const r = (derniere.answers as Record<string, number> | null)?.[q.id];
            return Number.isInteger(r) ? (r as number) : null;
          })(),
          bonneReponse: Number(q.expected_answer?.index ?? -1),
          explication: q.explanation ?? null,
        }
      : null;

  // Traçabilité avant l'appel (pattern genererFormation).
  const { data: generation } = await supabase
    .from("ai_generations")
    .insert({
      organization_id: ctx.course.organization_id,
      requested_by: user.id,
      generation_type: "tutor_help",
      brief: { help_type: type, question_id: q.id },
      context: { activity_id: activityId, course_id: ctx.course.id, competency_id: competencyId },
      prompt_version: PROMPT_VERSION_TUTEUR,
      model_name: modeleConfigure(),
      status: "running",
    })
    .select("id")
    .single();

  let texte: string;
  try {
    if (modeSimulation()) {
      texte = simulerAide(type, q.prompt);
    } else {
      const reponse = await appelerLlm(
        SYSTEM_TUTEUR,
        construirePromptAide({
          type,
          enonce: q.prompt,
          options: (q.options as string[]) ?? [],
          extraitLecon: ctx.extraitLecon || null,
          competence: competenceNom,
          tentative,
        })
      );
      texte = reponse.texte.trim();
      if (generation) {
        await supabase
          .from("ai_generations")
          .update({ model_name: reponse.modele, input_tokens: reponse.inputTokens, output_tokens: reponse.outputTokens })
          .eq("id", generation.id);
      }
    }
  } catch (erreur) {
    loguer("appel LLM", erreur);
    if (generation) {
      await supabase
        .from("ai_generations")
        .update({ status: "failed", error_message: erreur instanceof Error ? erreur.message : "échec", completed_at: new Date().toISOString() })
        .eq("id", generation.id);
    }
    return { error: erreur instanceof Error ? erreur.message : "Le tuteur n'a pas pu répondre. Réessayez." };
  }
  if (!texte) return { error: "Le tuteur n'a rien renvoyé. Réessayez." };

  if (generation) {
    await supabase
      .from("ai_generations")
      .update({ status: "succeeded", result: { texte }, completed_at: new Date().toISOString() })
      .eq("id", generation.id);
  }

  try {
    const admin = createAdminClient();
    await admin.from("tutor_help_events").insert({
      user_id: user.id,
      organization_id: ctx.course.organization_id,
      course_id: ctx.course.id,
      activity_id: activityId,
      question_id: q.id,
      competency_id: competencyId,
      help_type: type,
      generation_id: generation?.id ?? null,
      response_text: texte.slice(0, 2000),
    });
  } catch (erreur) {
    loguer("événement d'aide", erreur);
  }

  if (competencyId) {
    await recalculerScoreBlocage({
      userId: user.id,
      organizationId: ctx.course.organization_id,
      courseId: ctx.course.id,
      competencyId,
    });
  }

  revalidatePath(`/formations/${ctx.course.id}/activite/${activityId}`);
  return { success: texte };
}

// ------------------------------------------------------------
// Exercices personnalisés
// ------------------------------------------------------------

export async function genererExercices(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await getCurrentUser();
  if (!user) return { error: "Vous devez être connecté." };

  const courseId = String(formData.get("course_id") ?? "");
  const competencyId = String(formData.get("competency_id") ?? "");
  const nb = Math.min(5, Math.max(1, parseInt(String(formData.get("nb") ?? "2"), 10) || 2));
  if (!courseId || !competencyId) return { error: "Choisissez une compétence." };
  if (!iaConfiguree() && !modeSimulation()) {
    return { error: "Le tuteur IA n'est pas configuré sur cette installation (voir .env.example)." };
  }

  const dejaAujourdhui = await generationsDuJour(user.id, ["tutor_exercises"]);
  if (!peutGenerer(dejaAujourdhui)) {
    return { error: "Vous avez atteint la limite de 5 générations d'exercices par jour." };
  }

  const supabase = await createClient();
  const [{ data: course }, { data: competence }, { data: blocage }, { data: progres }] = await Promise.all([
    supabase.from("courses").select("id, title, organization_id, sector, current_version_id").eq("id", courseId).maybeSingle(),
    supabase.from("competencies").select("id, name, description, domain").eq("id", competencyId).maybeSingle(),
    supabase
      .from("competency_blocking_scores")
      .select("score, band, blocking_types")
      .eq("user_id", user.id)
      .eq("course_id", courseId)
      .eq("competency_id", competencyId)
      .maybeSingle(),
    supabase
      .from("progress_records")
      .select("mastery_level")
      .eq("user_id", user.id)
      .eq("course_id", courseId)
      .eq("competency_id", competencyId)
      .maybeSingle(),
  ]);
  if (!course || !competence) return { error: "Formation ou compétence introuvable." };

  // Extraits des leçons liées à la compétence, pour ancrer les exercices.
  const { data: liens } = await supabase
    .from("activity_competencies")
    .select("activity:activities(lesson:lessons(content))")
    .eq("competency_id", competencyId)
    .limit(3);
  const extraits = (liens ?? [])
    .map((l) => ((premier(premier(l.activity)?.lesson)?.content ?? {}) as { text?: string }).text)
    .filter((t): t is string => Boolean(t))
    .map((t) => t.slice(0, 1200));

  const bande = bandeDeBlocage(blocage?.score === null || blocage?.score === undefined ? null : Number(blocage.score)).bande;
  const typeExercice = typeExerciceRecommande(bande, (progres?.mastery_level as string) ?? null);

  const { data: generation } = await supabase
    .from("ai_generations")
    .insert({
      organization_id: course.organization_id,
      requested_by: user.id,
      generation_type: "tutor_exercises",
      brief: { competency_id: competencyId, nb, type: typeExercice },
      context: { course_id: courseId, bande },
      prompt_version: PROMPT_VERSION_EXERCICES,
      model_name: modeleConfigure(),
      status: "running",
    })
    .select("id")
    .single();

  const echec = async (message: string) => {
    if (generation) {
      await supabase
        .from("ai_generations")
        .update({ status: "failed", error_message: message, completed_at: new Date().toISOString() })
        .eq("id", generation.id);
    }
    return { error: message };
  };

  let texte: string;
  try {
    texte = modeSimulation()
      ? simulerExercices(competence.name as string, typeExercice, nb)
      : (
          await appelerLlm(
            SYSTEM_EXERCICES,
            construirePromptExercices({
              competence: competence.name as string,
              descriptionCompetence: (competence.description as string) ?? null,
              domaine: (competence.domain as string) ?? null,
              niveau: (progres?.mastery_level as string) ?? null,
              bande,
              typesBlocage: (blocage?.blocking_types as string[]) ?? [],
              typeExercice,
              secteur: (course.sector as string) ?? null,
              nb,
              extraitsLecons: extraits,
            })
          )
        ).texte;
  } catch (erreur) {
    loguer("appel LLM", erreur);
    return echec(erreur instanceof Error ? erreur.message : "La génération a échoué.");
  }

  const validation = validerExercicesGeneres(extraireJson(texte));
  if (!validation.ok) return echec(validation.erreur);

  try {
    const admin = createAdminClient();
    for (const e of validation.exercices) {
      const { content, solution } = separerSolution(e);
      const { data: cree, error } = await admin
        .from("personalized_exercises")
        .insert({
          user_id: user.id,
          organization_id: course.organization_id,
          course_id: courseId,
          competency_id: competencyId,
          exercise_type: (e.type as TypeExercice) ?? typeExercice,
          difficulty: e.difficulty,
          blocking_types: (blocage?.blocking_types as string[]) ?? [],
          content,
          generation_id: generation?.id ?? null,
        })
        .select("id")
        .single();
      if (error || !cree) {
        loguer("exercice", error);
        continue;
      }
      const { error: erreurSolution } = await admin
        .from("personalized_exercise_solutions")
        .insert({ exercise_id: cree.id, solution });
      loguer("solution", erreurSolution);
    }
  } catch (erreur) {
    loguer("enregistrement des exercices", erreur);
    return echec("Les exercices n'ont pas pu être enregistrés.");
  }

  if (generation) {
    await supabase
      .from("ai_generations")
      .update({ status: "succeeded", result: { nb: validation.exercices.length }, completed_at: new Date().toISOString() })
      .eq("id", generation.id);
  }

  await emettreNotification({
    userId: user.id,
    organizationId: course.organization_id,
    type: "exercices_prets",
    title: `${validation.exercices.length} exercice${validation.exercices.length > 1 ? "s" : ""} personnalisé${validation.exercices.length > 1 ? "s" : ""} sur « ${competence.name} »`,
    body: `Type : ${typeExercice}, adapté à votre score de blocage.`,
    href: `/tutorat?formation=${courseId}`,
  });

  revalidatePath("/tutorat");
  redirect(`/tutorat?formation=${courseId}&generes=${validation.exercices.length}`);
}

export async function repondreExercice(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await getCurrentUser();
  if (!user) return { error: "Vous devez être connecté." };

  const exerciseId = String(formData.get("exercise_id") ?? "");
  const affichageMs = parseInt(String(formData.get("started_at") ?? ""), 10);
  const supabase = await createClient();
  const { data: exercice } = await supabase
    .from("personalized_exercises")
    .select("id, user_id, organization_id, course_id, competency_id, exercise_type, content, status")
    .eq("id", exerciseId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!exercice) return { error: "Exercice introuvable." };
  if (exercice.status === "completed") return { error: "Cet exercice est déjà terminé." };

  const content = exercice.content as ContenuExercice;
  const reponses = lireReponsesExercice(content, (cle) => {
    const v = formData.get(cle);
    return v === null ? null : String(v);
  });
  if (Object.keys(reponses).length === 0) return { error: "Répondez à au moins une question." };

  let correction: ResultatCorrection;
  try {
    const admin = createAdminClient();
    const { data: sol } = await admin
      .from("personalized_exercise_solutions")
      .select("solution")
      .eq("exercise_id", exerciseId)
      .maybeSingle();
    if (!sol) return { error: "Solution introuvable : cet exercice ne peut pas être corrigé." };
    correction = corrigerExercice(content, sol.solution as SolutionExercice, reponses);

    await admin
      .from("personalized_exercises")
      .update({
        status: "completed",
        answers: reponses,
        score: correction.scorePourcent,
        feedback: correction as unknown as Record<string, unknown>,
        completed_at: new Date().toISOString(),
      })
      .eq("id", exerciseId);
  } catch (erreur) {
    loguer("correction", erreur);
    return { error: "La correction a échoué. Réessayez." };
  }

  const dureeSecondes = Number.isFinite(affichageMs) && affichageMs > 0 ? (Date.now() - affichageMs) / 1000 : null;
  const rapide = dureeSecondes !== null && dureeSecondes <= content.questions.length * 20;
  const gain = xpExercice(exercice.exercise_type as TypeExercice, correction.scorePourcent, rapide);
  let credite = 0;
  if (gain > 0) {
    credite = await attribuerXp({
      userId: user.id,
      organizationId: exercice.organization_id as string,
      type: "exercice_perso",
      montant: gain,
      referenceId: exerciseId,
      courseId: exercice.course_id as string,
      details: { type: exercice.exercise_type, score: correction.scorePourcent },
    });
  }

  await compterExercicePerso({ userId: user.id, courseId: exercice.course_id as string, competencyId: exercice.competency_id as string });
  await recalculerScoreBlocage({
    userId: user.id,
    organizationId: exercice.organization_id as string,
    courseId: exercice.course_id as string,
    competencyId: exercice.competency_id as string,
  });
  await verifierBadges(user.id, exercice.organization_id as string);

  revalidatePath(`/tutorat/exercice/${exerciseId}`);
  revalidatePath("/tutorat");
  return {
    success: `Score : ${correction.scorePourcent} % (${correction.nbCorrectes}/${correction.nbQuestions}).${credite > 0 ? ` +${credite} XP.` : correction.scorePourcent < 80 ? " Un exercice compte à partir de 80 %." : ""} La correction s'affiche ci-dessous.`,
  };
}

export async function marquerRecommandationFaite(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await getCurrentUser();
  if (!user) return { error: "Vous devez être connecté." };
  const id = String(formData.get("recommendation_id") ?? "");
  const supabase = await createClient();
  const { error } = await supabase
    .from("personalized_recommendations")
    .update({ is_completed: true, completed_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", user.id);
  if (error) {
    loguer("recommandation", error);
    return { error: "L'opération a échoué." };
  }
  revalidatePath("/tutorat");
  return { success: "Recommandation marquée comme faite." };
}

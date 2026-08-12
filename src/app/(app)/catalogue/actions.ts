"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/profile";
import {
  canCreateCourse,
  canTransition,
  isContentEditable,
  slugify,
  type CourseStatus,
} from "@/lib/courses/statuts";

export interface ActionState {
  error?: string;
  success?: string;
}

const ERREUR_GENERIQUE =
  "L'opération a échoué. Vérifiez vos droits ou réessayez plus tard.";

/**
 * Journalise une erreur base de données côté serveur (jamais côté
 * navigateur). Les messages Postgres ne contiennent ni clés ni
 * données personnelles ; ils sont indispensables au diagnostic.
 */
function loguerErreur(contexte: string, error: { message?: string; code?: string } | null) {
  if (error) {
    console.error(`[catalogue] ${contexte} :`, error.code ?? "", error.message ?? error);
  }
}

/** Récupère une formation et vérifie qu'elle est modifiable par l'utilisateur. */
async function chargerFormationModifiable(courseId: string) {
  const user = await getCurrentUser();
  if (!user) return { error: "Vous devez être connecté." as const };

  const supabase = await createClient();
  const { data: course } = await supabase
    .from("courses")
    .select("id, organization_id, status, current_version_id, title")
    .eq("id", courseId)
    .maybeSingle();

  if (!course) return { error: "Formation introuvable ou non autorisée." as const };
  return { user, supabase, course };
}

// ------------------------------------------------------------
// Création d'une formation (avec version 1)
// ------------------------------------------------------------

export async function creerFormation(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await getCurrentUser();
  if (!user) return { error: "Vous devez être connecté." };

  const organizationId = String(formData.get("organization_id") ?? "");
  const title = String(formData.get("title") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const contextType = String(formData.get("context_type") ?? "generic");
  const sector = String(formData.get("sector") ?? "").trim();
  const format = String(formData.get("format") ?? "online");
  const duration = parseInt(String(formData.get("duration_minutes") ?? ""), 10);

  if (!organizationId) return { error: "Veuillez choisir une organisation." };
  if (!title) return { error: "Veuillez saisir le titre de la formation." };
  if (!canCreateCourse(user.memberships, organizationId)) {
    return { error: "Vous n'avez pas le droit de créer une formation dans cette organisation." };
  }

  const supabase = await createClient();

  // Slug unique par organisation (suffixe numérique en cas de doublon).
  const base = slugify(title);
  let slug = base;
  for (let i = 2; i <= 20; i++) {
    const { data: existant } = await supabase
      .from("courses")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("slug", slug)
      .maybeSingle();
    if (!existant) break;
    slug = `${base}-${i}`;
  }

  const { data: course, error } = await supabase
    .from("courses")
    .insert({
      organization_id: organizationId,
      owner_id: user.id,
      title,
      slug,
      description: description || null,
      context_type: contextType,
      sector: sector || null,
      format,
      duration_minutes: Number.isFinite(duration) ? duration : null,
      status: "draft",
    })
    .select("id")
    .single();

  if (error || !course) {
    loguerErreur("création de formation", error);
    return { error: ERREUR_GENERIQUE };
  }

  const { data: version, error: erreurVersion } = await supabase
    .from("course_versions")
    .insert({
      course_id: course.id,
      version_number: 1,
      change_summary: "Version initiale",
      created_by: user.id,
      status: "draft",
    })
    .select("id")
    .single();

  if (erreurVersion || !version) {
    loguerErreur("création de la version initiale", erreurVersion);
    return {
      error:
        "La formation a été créée mais sa version initiale a échoué. Ouvrez la formation et réessayez.",
    };
  }

  await supabase
    .from("courses")
    .update({ current_version_id: version.id })
    .eq("id", course.id);

  revalidatePath("/catalogue");
  redirect(`/catalogue/${course.id}/modifier`);
}

// ------------------------------------------------------------
// Mise à jour de la fiche (uniquement en brouillon)
// ------------------------------------------------------------

export async function mettreAJourFiche(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const courseId = String(formData.get("course_id") ?? "");
  const ctx = await chargerFormationModifiable(courseId);
  if ("error" in ctx) return { error: ctx.error };
  const { supabase, course } = ctx;

  if (!isContentEditable(course.status as CourseStatus)) {
    return {
      error:
        "Cette formation n'est plus en brouillon : repassez-la en brouillon pour la modifier.",
    };
  }

  const title = String(formData.get("title") ?? "").trim();
  if (!title) return { error: "Le titre ne peut pas être vide." };
  const duration = parseInt(String(formData.get("duration_minutes") ?? ""), 10);

  const { error } = await supabase
    .from("courses")
    .update({
      title,
      description: String(formData.get("description") ?? "").trim() || null,
      target_audience: String(formData.get("target_audience") ?? "").trim() || null,
      prerequisites: String(formData.get("prerequisites") ?? "").trim() || null,
      sector: String(formData.get("sector") ?? "").trim() || null,
      context_type: String(formData.get("context_type") ?? "generic"),
      format: String(formData.get("format") ?? "online"),
      duration_minutes: Number.isFinite(duration) ? duration : null,
    })
    .eq("id", courseId);

  if (error) return { error: ERREUR_GENERIQUE };
  revalidatePath(`/catalogue/${courseId}/modifier`);
  return { success: "Fiche enregistrée." };
}

// ------------------------------------------------------------
// Transitions de statut (cycle de validation)
// ------------------------------------------------------------

const STATUTS_VALIDES: CourseStatus[] = [
  "draft",
  "review",
  "approved",
  "published",
  "archived",
];

export async function changerStatut(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const courseId = String(formData.get("course_id") ?? "");
  const cible = String(formData.get("cible") ?? "") as CourseStatus;

  if (!STATUTS_VALIDES.includes(cible)) return { error: "Statut invalide." };

  const ctx = await chargerFormationModifiable(courseId);
  if ("error" in ctx) return { error: ctx.error };
  const { user, supabase, course } = ctx;

  const depuis = course.status as CourseStatus;
  if (!canTransition(user.memberships, course.organization_id, depuis, cible)) {
    return {
      error: "Cette transition n'est pas autorisée pour votre rôle.",
    };
  }

  const { error } = await supabase
    .from("courses")
    .update({ status: cible })
    .eq("id", courseId);
  if (error) return { error: ERREUR_GENERIQUE };

  // Traçabilité IA : si la formation provient d'une génération,
  // enregistrer la décision humaine (approbation ou corrections).
  if (cible === "approved" || (depuis === "review" && cible === "draft")) {
    const { data: gen } = await supabase
      .from("ai_generations")
      .select("id")
      .eq("result_course_id", courseId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (gen) {
      const { error: erreurValidation } = await supabase
        .from("ai_validations")
        .insert({
          generation_id: gen.id,
          reviewer_id: user.id,
          decision: cible === "approved" ? "approved" : "changes_requested",
        });
      loguerErreur("enregistrement de la validation IA", erreurValidation);
    }
  }

  // Trace sur la version courante.
  if (course.current_version_id) {
    const patch: Record<string, unknown> = { status: cible };
    if (cible === "approved") {
      patch.approved_by = user.id;
      patch.approved_at = new Date().toISOString();
    }
    if (cible === "published") {
      patch.published_at = new Date().toISOString();
    }
    await supabase
      .from("course_versions")
      .update(patch)
      .eq("id", course.current_version_id);
  }

  revalidatePath(`/catalogue/${courseId}/modifier`);
  revalidatePath("/catalogue");
  return { success: "Statut mis à jour." };
}

// ------------------------------------------------------------
// Modules et leçons (uniquement en brouillon)
// ------------------------------------------------------------

async function verifierEditionContenu(courseId: string) {
  const ctx = await chargerFormationModifiable(courseId);
  if ("error" in ctx) return { error: ctx.error };
  if (!isContentEditable(ctx.course.status as CourseStatus)) {
    return {
      error:
        "Le contenu n'est modifiable qu'en brouillon. Repassez la formation en brouillon d'abord.",
    };
  }
  return ctx;
}

export async function ajouterModule(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const courseId = String(formData.get("course_id") ?? "");
  const title = String(formData.get("title") ?? "").trim();
  if (!title) return { error: "Veuillez saisir le titre du module." };

  const ctx = await verifierEditionContenu(courseId);
  if ("error" in ctx) return { error: ctx.error };
  const { supabase, course } = ctx;
  if (!course.current_version_id) return { error: ERREUR_GENERIQUE };

  const { count } = await supabase
    .from("modules")
    .select("id", { count: "exact", head: true })
    .eq("course_version_id", course.current_version_id);

  const { error } = await supabase.from("modules").insert({
    course_version_id: course.current_version_id,
    title,
    description: String(formData.get("description") ?? "").trim() || null,
    position: (count ?? 0) + 1,
    status: "draft",
  });

  if (error) return { error: ERREUR_GENERIQUE };
  revalidatePath(`/catalogue/${courseId}/modifier`);
  return { success: "Module ajouté." };
}

export async function supprimerModule(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const courseId = String(formData.get("course_id") ?? "");
  const moduleId = String(formData.get("module_id") ?? "");

  const ctx = await verifierEditionContenu(courseId);
  if ("error" in ctx) return { error: ctx.error };

  const { error } = await ctx.supabase.from("modules").delete().eq("id", moduleId);
  if (error) return { error: ERREUR_GENERIQUE };
  revalidatePath(`/catalogue/${courseId}/modifier`);
  return { success: "Module supprimé (leçons incluses)." };
}

export async function ajouterLecon(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const courseId = String(formData.get("course_id") ?? "");
  const moduleId = String(formData.get("module_id") ?? "");
  const title = String(formData.get("title") ?? "").trim();
  const texte = String(formData.get("texte") ?? "").trim();
  const minutes = parseInt(String(formData.get("estimated_minutes") ?? ""), 10);

  if (!title) return { error: "Veuillez saisir le titre de la leçon." };

  const ctx = await verifierEditionContenu(courseId);
  if ("error" in ctx) return { error: ctx.error };
  const { supabase } = ctx;

  const { count } = await supabase
    .from("lessons")
    .select("id", { count: "exact", head: true })
    .eq("module_id", moduleId);

  const { error } = await supabase.from("lessons").insert({
    module_id: moduleId,
    title,
    content: { type: "text", text: texte },
    position: (count ?? 0) + 1,
    estimated_minutes: Number.isFinite(minutes) ? minutes : null,
    status: "draft",
  });

  if (error) return { error: ERREUR_GENERIQUE };
  revalidatePath(`/catalogue/${courseId}/modifier`);
  return { success: "Leçon ajoutée." };
}

export async function supprimerLecon(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const courseId = String(formData.get("course_id") ?? "");
  const lessonId = String(formData.get("lesson_id") ?? "");

  const ctx = await verifierEditionContenu(courseId);
  if ("error" in ctx) return { error: ctx.error };

  const { error } = await ctx.supabase.from("lessons").delete().eq("id", lessonId);
  if (error) return { error: ERREUR_GENERIQUE };
  revalidatePath(`/catalogue/${courseId}/modifier`);
  return { success: "Leçon supprimée." };
}

// ------------------------------------------------------------
// QCM : activités et questions (uniquement en brouillon)
// ------------------------------------------------------------

export async function creerQcm(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const courseId = String(formData.get("course_id") ?? "");
  const lessonId = String(formData.get("lesson_id") ?? "");
  const title = String(formData.get("title") ?? "").trim();
  if (!title) return { error: "Veuillez saisir le titre du QCM." };

  const ctx = await verifierEditionContenu(courseId);
  if ("error" in ctx) return { error: ctx.error };
  const { supabase } = ctx;

  const { count } = await supabase
    .from("activities")
    .select("id", { count: "exact", head: true })
    .eq("lesson_id", lessonId);

  const { data: activite, error } = await supabase
    .from("activities")
    .insert({
      lesson_id: lessonId,
      type: "quiz",
      title,
      instructions: String(formData.get("instructions") ?? "").trim() || null,
      difficulty: 1,
      position: (count ?? 0) + 1,
      status: "draft",
    })
    .select("id")
    .single();

  if (error || !activite) {
    loguerErreur("création du QCM", error);
    return { error: ERREUR_GENERIQUE };
  }

  redirect(`/catalogue/${courseId}/qcm/${activite.id}`);
}

export async function supprimerActivite(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const courseId = String(formData.get("course_id") ?? "");
  const activityId = String(formData.get("activity_id") ?? "");

  const ctx = await verifierEditionContenu(courseId);
  if ("error" in ctx) return { error: ctx.error };

  const { error } = await ctx.supabase
    .from("activities")
    .delete()
    .eq("id", activityId);
  if (error) return { error: ERREUR_GENERIQUE };
  revalidatePath(`/catalogue/${courseId}/modifier`);
  return { success: "Activité supprimée (questions incluses)." };
}

export async function ajouterQuestion(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const courseId = String(formData.get("course_id") ?? "");
  const activityId = String(formData.get("activity_id") ?? "");
  const prompt = String(formData.get("prompt") ?? "").trim();
  const explication = String(formData.get("explanation") ?? "").trim();
  const competencyId = String(formData.get("competency_id") ?? "");
  const difficulty = parseInt(String(formData.get("difficulty") ?? "1"), 10);
  const bonne = parseInt(String(formData.get("bonne") ?? "-1"), 10);

  const options = [0, 1, 2, 3]
    .map((i) => String(formData.get(`opt_${i}`) ?? "").trim())
    .filter(Boolean);

  if (!prompt) return { error: "Veuillez saisir l'énoncé de la question." };
  if (options.length < 2) {
    return { error: "Une question doit proposer au moins deux options." };
  }
  if (!Number.isInteger(bonne) || bonne < 0 || bonne >= options.length) {
    return { error: "Indiquez quelle option est la bonne réponse." };
  }

  const ctx = await verifierEditionContenu(courseId);
  if ("error" in ctx) return { error: ctx.error };
  const { supabase } = ctx;

  const { count } = await supabase
    .from("questions")
    .select("id", { count: "exact", head: true })
    .eq("activity_id", activityId);

  const { error } = await supabase.from("questions").insert({
    activity_id: activityId,
    type: "qcm",
    prompt,
    options,
    expected_answer: { index: bonne },
    explanation: explication || null,
    difficulty: Number.isFinite(difficulty) ? Math.min(5, Math.max(1, difficulty)) : 1,
    competency_id: competencyId || null,
    position: (count ?? 0) + 1,
  });

  if (error) {
    loguerErreur("ajout de question", error);
    return { error: ERREUR_GENERIQUE };
  }

  // Lier la compétence à l'activité pour la progression.
  if (competencyId) {
    await supabase.from("activity_competencies").upsert(
      { activity_id: activityId, competency_id: competencyId },
      { onConflict: "activity_id,competency_id" }
    );
  }

  revalidatePath(`/catalogue/${courseId}/qcm/${activityId}`);
  return { success: "Question ajoutée." };
}

export async function supprimerQuestion(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const courseId = String(formData.get("course_id") ?? "");
  const activityId = String(formData.get("activity_id") ?? "");
  const questionId = String(formData.get("question_id") ?? "");

  const ctx = await verifierEditionContenu(courseId);
  if ("error" in ctx) return { error: ctx.error };

  const { error } = await ctx.supabase
    .from("questions")
    .delete()
    .eq("id", questionId);
  if (error) return { error: ERREUR_GENERIQUE };
  revalidatePath(`/catalogue/${courseId}/qcm/${activityId}`);
  return { success: "Question supprimée." };
}

// ------------------------------------------------------------
// Compétences liées à la formation
// ------------------------------------------------------------

export async function lierCompetence(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const courseId = String(formData.get("course_id") ?? "");
  const competencyId = String(formData.get("competency_id") ?? "");
  const level = String(formData.get("target_level") ?? "fundamentals");

  if (!competencyId) return { error: "Veuillez choisir une compétence." };

  const ctx = await verifierEditionContenu(courseId);
  if ("error" in ctx) return { error: ctx.error };

  const { error } = await ctx.supabase.from("course_competencies").upsert(
    {
      course_id: courseId,
      competency_id: competencyId,
      target_level: level,
    },
    { onConflict: "course_id,competency_id" }
  );

  if (error) return { error: ERREUR_GENERIQUE };
  revalidatePath(`/catalogue/${courseId}/modifier`);
  return { success: "Compétence liée à la formation." };
}

export async function retirerCompetence(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const courseId = String(formData.get("course_id") ?? "");
  const competencyId = String(formData.get("competency_id") ?? "");

  const ctx = await verifierEditionContenu(courseId);
  if ("error" in ctx) return { error: ctx.error };

  const { error } = await ctx.supabase
    .from("course_competencies")
    .delete()
    .eq("course_id", courseId)
    .eq("competency_id", competencyId);

  if (error) return { error: ERREUR_GENERIQUE };
  revalidatePath(`/catalogue/${courseId}/modifier`);
  return { success: "Compétence retirée." };
}

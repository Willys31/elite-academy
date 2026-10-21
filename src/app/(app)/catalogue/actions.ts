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
import {
  lireReponsesAcceptees,
  lireTypeQuestion,
  OPTIONS_VRAI_FAUX,
  TYPE_QUESTION_LABELS,
} from "@/lib/courses/questions";
import {
  activiteDepuisPlan,
  grilleDepuisActivite,
  lireContenuActiviteRedigee,
  lireFormulaireActiviteRedigee,
  retirerBlocActivites,
  type ActiviteRedigeeACreer,
} from "@/lib/courses/activites-redigees";
import { validerActiviteGeneree } from "@/lib/ai/schema";

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

  /* Test de positionnement (PRD §9) : un QCM marqué `placement`, proposé
     avant les leçons, sans XP, avec un bilan par compétence. Voir
     src/lib/courses/positionnement.ts. */
  const placement = formData.get("placement") === "on";

  const { data: activite, error } = await supabase
    .from("activities")
    .insert({
      lesson_id: lessonId,
      type: "quiz",
      title,
      instructions:
        String(formData.get("instructions") ?? "").trim() ||
        (placement
          ? "Ce test mesure votre niveau de départ, compétence par compétence. Répondez sans vous documenter : il n'y a ni bonne ni mauvaise note, seulement un point de départ."
          : null),
      content: placement ? { placement: true } : {},
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
  const type = lireTypeQuestion(String(formData.get("type") ?? "qcm"));
  const prompt = String(formData.get("prompt") ?? "").trim();
  const explication = String(formData.get("explanation") ?? "").trim();
  const competencyId = String(formData.get("competency_id") ?? "");
  const difficulty = parseInt(String(formData.get("difficulty") ?? "1"), 10);
  const bonne = parseInt(String(formData.get("bonne") ?? "-1"), 10);

  if (!prompt) return { error: "Veuillez saisir l'énoncé de la question." };

  /* Options et corrigé selon le type (PRD §14, lot 23). Le corrigé est
     illisible par les rôles applicatifs (migration 0019) : seule sa
     forme change ici, jamais son exposition. */
  let options: string[] = [];
  let expectedAnswer: Record<string, unknown> = {};

  if (type === "qcm") {
    options = [0, 1, 2, 3]
      .map((i) => String(formData.get(`opt_${i}`) ?? "").trim())
      .filter(Boolean);
    if (options.length < 2) {
      return { error: "Une question doit proposer au moins deux options." };
    }
    if (!Number.isInteger(bonne) || bonne < 0 || bonne >= options.length) {
      return { error: "Indiquez quelle option est la bonne réponse." };
    }
    expectedAnswer = { index: bonne };
  } else if (type === "true_false") {
    options = [...OPTIONS_VRAI_FAUX];
    if (bonne !== 0 && bonne !== 1) {
      return { error: "Indiquez si l'affirmation est vraie ou fausse." };
    }
    expectedAnswer = { index: bonne };
  } else if (type === "short_answer") {
    const acceptees = lireReponsesAcceptees(String(formData.get("accepted") ?? ""));
    if (acceptees.length === 0) {
      return { error: "Indiquez au moins une réponse acceptée (une par ligne)." };
    }
    expectedAnswer = { accepted: acceptees };
  } else {
    const grille = String(formData.get("rubric") ?? "").trim();
    expectedAnswer = grille ? { rubric: grille } : {};
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
    type,
    prompt,
    options,
    expected_answer: expectedAnswer,
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
  return { success: `Question ajoutée (${TYPE_QUESTION_LABELS[type]}).` };
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

// ------------------------------------------------------------
// Suppression définitive d'une formation
// ------------------------------------------------------------

interface Blocages {
  inscriptions: number;
  certificats: number;
  sessions: number;
  supports: number;
}

/** Accorde le pluriel du décompte à son nom (« 1 inscription », « 3 inscriptions »). */
function compte(n: number, singulier: string, pluriel: string) {
  return `${n} ${n > 1 ? pluriel : singulier}`;
}

/**
 * Supprime définitivement une formation, ses versions, modules,
 * leçons, activités et questions (cascade en base).
 *
 * La suppression est refusée dès qu'un apprenant a laissé une trace :
 * une inscription ou un certificat. La clé étrangère est en
 * `on delete cascade` sur ces deux tables, donc supprimer sans ce
 * garde-fou détruirait sans un mot des certificats qui doivent rester
 * vérifiables à vie. L'archivage, déjà présent dans le cycle de
 * statuts, est la bonne réponse dans ce cas.
 *
 * Les fichiers du bucket « supports » et les lignes `sources`
 * associées ne sont rattachés à la formation par aucune clé étrangère :
 * ils sont retirés explicitement, sinon ils resteraient orphelins.
 */
export async function supprimerFormation(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const courseId = String(formData.get("course_id") ?? "");

  const ctx = await chargerFormationModifiable(courseId);
  if ("error" in ctx) return { error: ctx.error };
  const { supabase, course } = ctx;

  // Décompte via une fonction `security definer` : un administrateur
  // d'organisation ne voit pas forcément toutes les inscriptions ni
  // tous les certificats par RLS, un simple `count` ici remonterait
  // zéro et le garde-fou ne servirait à rien.
  const { data, error: erreurBlocages } = await supabase.rpc(
    "course_deletion_blockers",
    { cid: courseId }
  );
  if (erreurBlocages) {
    loguerErreur("décompte avant suppression", erreurBlocages);
    // 42P01 : une table du décompte est absente, donc une migration
    // n'a pas été appliquée. Le dire explicitement évite de chercher
    // un problème de droits là où il n'y en a pas.
    if (erreurBlocages.code === "42P01") {
      return {
        error:
          "Le contrôle de sécurité avant suppression n'a pas pu s'exécuter : " +
          "une table manque en base. Appliquez les migrations manquantes " +
          "(voir README §3, notamment 0007_certificats.sql), puis réessayez.",
      };
    }
    // 42883 : la fonction elle-même n'existe pas.
    if (erreurBlocages.code === "42883" || erreurBlocages.code === "PGRST202") {
      return {
        error:
          "Le contrôle de sécurité avant suppression est introuvable. " +
          "Appliquez la migration 0009_suppressions.sql, puis réessayez.",
      };
    }
    return { error: ERREUR_GENERIQUE };
  }

  const blocages = (Array.isArray(data) ? data[0] : data) as Blocages | undefined;
  if (!blocages) return { error: ERREUR_GENERIQUE };

  const raisons: string[] = [];
  if (blocages.inscriptions > 0) {
    raisons.push(compte(blocages.inscriptions, "inscription", "inscriptions"));
  }
  if (blocages.certificats > 0) {
    raisons.push(compte(blocages.certificats, "certificat délivré", "certificats délivrés"));
  }
  if (raisons.length > 0) {
    return {
      error:
        `Suppression impossible : cette formation compte ${raisons.join(" et ")}. ` +
        "Supprimer détruirait ces traces, et un certificat doit rester " +
        "vérifiable à vie. Archivez-la plutôt : elle disparaît du catalogue " +
        "actif tout en préservant l'historique.",
    };
  }

  // Fichiers de support : retirés du stockage avant la cascade, qui
  // effacerait les activités et donc l'emplacement des fichiers.
  if (blocages.supports > 0 && course.current_version_id) {
    const { data: supports } = await supabase
      .from("activities")
      .select("content, lesson:lessons!inner(module:modules!inner(course_version_id))")
      .eq("type", "file")
      .eq("lesson.module.course_version_id", course.current_version_id);

    const chemins: string[] = [];
    const sourceIds: string[] = [];
    for (const a of supports ?? []) {
      const contenu = (a.content ?? {}) as { file_path?: string; source_id?: string };
      if (contenu.file_path) chemins.push(contenu.file_path);
      if (contenu.source_id) sourceIds.push(contenu.source_id);
    }
    if (chemins.length > 0) {
      const { error } = await supabase.storage.from("supports").remove(chemins);
      loguerErreur("retrait des fichiers de support", error);
    }
    if (sourceIds.length > 0) {
      const { error } = await supabase.from("sources").delete().in("id", sourceIds);
      loguerErreur("retrait des sources", error);
    }
  }

  const { error } = await supabase.from("courses").delete().eq("id", courseId);
  if (error) {
    loguerErreur("suppression de la formation", error);
    return {
      error:
        "La suppression a échoué. Seul un administrateur de l'organisation " +
        "(ou d'Elite Experience) peut supprimer une formation.",
    };
  }

  revalidatePath("/catalogue");
  revalidatePath("/validation");
  redirect("/catalogue?supprimee=1");
}

// ------------------------------------------------------------
// Activités rédigées (lot 26) : exercice, étude de cas, simulation.
// Une activité = une ligne `activities` + UNE question `open` dont la
// grille (`expected_answer.rubric`, illisible de l'apprenant) reprend le
// résultat attendu et les critères. Modifiable en brouillon seulement.
// ------------------------------------------------------------

async function positionSuivante(
  supabase: Awaited<ReturnType<typeof createClient>>,
  lessonId: string
): Promise<number> {
  const { count } = await supabase
    .from("activities")
    .select("id", { count: "exact", head: true })
    .eq("lesson_id", lessonId);
  return (count ?? 0) + 1;
}

/** Insère activité + question ouverte + lien compétence. Renvoie l'identifiant de l'activité. */
async function insererActiviteRedigee(
  supabase: Awaited<ReturnType<typeof createClient>>,
  lessonId: string,
  a: ActiviteRedigeeACreer,
  competencyIds: Array<{ id: string; level?: string }>,
  genereeParIa: boolean
): Promise<string | null> {
  const { data: activite, error } = await supabase
    .from("activities")
    .insert({
      lesson_id: lessonId,
      type: a.activite.type,
      title: a.activite.title,
      instructions: a.activite.instructions,
      content: a.activite.content,
      difficulty: a.activite.difficulty,
      position: await positionSuivante(supabase, lessonId),
      generated_by_ai: genereeParIa,
      status: "draft",
    })
    .select("id")
    .single();
  if (error || !activite) {
    loguerErreur("création d'une activité rédigée", error);
    return null;
  }
  const { error: erreurQuestion } = await supabase.from("questions").insert({
    activity_id: activite.id,
    type: "open",
    prompt: a.question.prompt,
    options: [],
    expected_answer: a.question.expected_answer,
    explanation: null,
    difficulty: a.question.difficulty,
    competency_id: competencyIds[0]?.id ?? null,
    position: 1,
  });
  if (erreurQuestion) loguerErreur("question de l'activité rédigée", erreurQuestion);
  if (competencyIds.length > 0) {
    await supabase.from("activity_competencies").upsert(
      competencyIds.map((c) => ({ activity_id: activite.id, competency_id: c.id, level: c.level ?? "fundamentals", weight: 1 })),
      { onConflict: "activity_id,competency_id" }
    );
  }
  return activite.id;
}

export async function creerActiviteRedigee(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const courseId = String(formData.get("course_id") ?? "");
  const lessonId = String(formData.get("lesson_id") ?? "");
  const competencyId = String(formData.get("competency_id") ?? "");
  const lecture = lireFormulaireActiviteRedigee((nom) => String(formData.get(nom) ?? ""));
  if (!lecture.ok) return { error: lecture.erreur };

  const ctx = await verifierEditionContenu(courseId);
  if ("error" in ctx) return { error: ctx.error };
  const { supabase } = ctx;

  const id = await insererActiviteRedigee(supabase, lessonId, lecture.valeur, competencyId ? [{ id: competencyId }] : [], false);
  if (!id) return { error: ERREUR_GENERIQUE };
  redirect(`/catalogue/${courseId}/activite-redigee/${id}`);
}

export async function mettreAJourActiviteRedigee(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const courseId = String(formData.get("course_id") ?? "");
  const activityId = String(formData.get("activity_id") ?? "");
  const competencyId = String(formData.get("competency_id") ?? "");
  const lecture = lireFormulaireActiviteRedigee((nom) => String(formData.get(nom) ?? ""));
  if (!lecture.ok) return { error: lecture.erreur };

  const ctx = await verifierEditionContenu(courseId);
  if ("error" in ctx) return { error: ctx.error };
  const { supabase } = ctx;

  // Le contenu existant garde ce que le formulaire ne porte pas
  // (compétences nommées, média décrit, provenance IA).
  const { data: existante } = await supabase
    .from("activities")
    .select("id, content")
    .eq("id", activityId)
    .maybeSingle();
  if (!existante) return { error: "Activité introuvable." };
  const ancien = lireContenuActiviteRedigee(existante.content);
  const a = lecture.valeur;
  const content = {
    ...ancien,
    expected_outcome: a.activite.content.expected_outcome,
    evaluation: a.activite.content.evaluation,
    situation_type: a.activite.content.situation_type ?? ancien.situation_type,
  };

  const { error } = await supabase
    .from("activities")
    .update({
      type: a.activite.type,
      title: a.activite.title,
      instructions: a.activite.instructions,
      content,
      difficulty: a.activite.difficulty,
    })
    .eq("id", activityId);
  if (error) {
    loguerErreur("mise à jour d'une activité rédigée", error);
    return { error: ERREUR_GENERIQUE };
  }

  // La question ouverte suit : consigne, grille, difficulté, compétence.
  const { data: question } = await supabase
    .from("questions")
    .select("id")
    .eq("activity_id", activityId)
    .order("position")
    .limit(1)
    .maybeSingle();
  const champsQuestion = {
    prompt: a.question.prompt,
    expected_answer: { rubric: grilleDepuisActivite(content) },
    difficulty: a.question.difficulty,
    competency_id: competencyId || null,
  };
  if (question) {
    await supabase.from("questions").update(champsQuestion).eq("id", question.id);
  } else {
    await supabase.from("questions").insert({ activity_id: activityId, type: "open", options: [], explanation: null, position: 1, ...champsQuestion });
  }
  if (competencyId) {
    await supabase.from("activity_competencies").upsert(
      { activity_id: activityId, competency_id: competencyId, weight: 1 },
      { onConflict: "activity_id,competency_id" }
    );
  }

  revalidatePath(`/catalogue/${courseId}/activite-redigee/${activityId}`);
  revalidatePath(`/catalogue/${courseId}/modifier`);
  return { success: "Activité enregistrée." };
}

/**
 * Reprise d'une leçon générée avant le lot 26 : ses activités décrites
 * dans `lessons.content.activities` deviennent de vraies activités, et
 * le bloc « — Activités — » ajouté à son texte est retiré. Une seule fois.
 */
export async function creerActivitesDepuisLecon(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const courseId = String(formData.get("course_id") ?? "");
  const lessonId = String(formData.get("lesson_id") ?? "");

  const ctx = await verifierEditionContenu(courseId);
  if ("error" in ctx) return { error: ctx.error };
  const { supabase, course } = ctx;

  const { data: lecon } = await supabase
    .from("lessons")
    .select("id, content")
    .eq("id", lessonId)
    .maybeSingle();
  if (!lecon) return { error: "Leçon introuvable." };
  const contenu = (lecon.content ?? {}) as Record<string, unknown>;
  const decrites = Array.isArray(contenu.activities) ? (contenu.activities as unknown[]) : [];
  if (decrites.length === 0) return { error: "Cette leçon ne décrit aucune activité à créer." };

  // Compétences de l'organisation, par nom (celles que le plan a nommées).
  const { data: competences } = await supabase
    .from("competencies")
    .select("id, name")
    .eq("organization_id", course.organization_id);
  const parNom = new Map((competences ?? []).map((c) => [String(c.name).trim().toLowerCase(), c.id as string]));
  const { data: niveaux } = await supabase
    .from("course_competencies")
    .select("competency_id, target_level")
    .eq("course_id", courseId);
  const niveauDe = new Map((niveaux ?? []).map((n) => [n.competency_id as string, n.target_level as string]));

  const version = typeof contenu.prompt_version === "string" ? contenu.prompt_version : "plan-formation/v2";
  let creees = 0;
  for (const brut of decrites) {
    const a = validerActiviteGeneree(brut);
    if (!a) continue;
    const redigee = activiteDepuisPlan(a, { prompt_version: version });
    if (!redigee) continue;
    const ids = redigee.competences
      .map((n) => parNom.get(n.trim().toLowerCase()))
      .filter((x): x is string => Boolean(x))
      .map((id) => ({ id, level: niveauDe.get(id) }));
    const id = await insererActiviteRedigee(supabase, lessonId, redigee, ids, true);
    if (id) creees += 1;
  }

  const { activities: _retirees, ...reste } = contenu;
  void _retirees;
  const texte = typeof contenu.text === "string" ? retirerBlocActivites(contenu.text) : contenu.text;
  await supabase
    .from("lessons")
    .update({ content: { ...reste, text: texte } })
    .eq("id", lessonId);

  revalidatePath(`/catalogue/${courseId}/modifier`);
  return { success: `${creees} activité${creees > 1 ? "s" : ""} créée${creees > 1 ? "s" : ""} à partir de la leçon.` };
}

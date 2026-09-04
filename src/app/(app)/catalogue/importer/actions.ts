"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { randomUUID } from "node:crypto";
import mammoth from "mammoth";
import { PDFParse } from "pdf-parse";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/profile";
import {
  canCreateCourse,
  isContentEditable,
  slugify,
  type CourseStatus,
} from "@/lib/courses/statuts";
import {
  decouperHtml,
  decouperTexte,
  htmlVersTexte,
  type Decoupage,
} from "@/lib/import/decoupage";
import { appelerLlm, iaConfiguree, modeleConfigure, modeSimulation } from "@/lib/ai/client";
import {
  construirePromptStructuration,
  PROMPT_VERSION_IMPORT,
  SYSTEM_IMPORT,
} from "@/lib/ai/prompts";
import { extraireJson, validerResultat, type ResultatGeneration } from "@/lib/ai/schema";
import type { ActionState } from "@/app/(app)/catalogue/actions";

/** Taille maximale du texte envoyé à l'IA (≈ 30 000 jetons). */
const MAX_TEXTE_IA = 120000;

const TAILLE_MAX = 20 * 1024 * 1024; // 20 Mo, alignée sur le bucket

const MIMES_SUPPORTS: Record<string, string> = {
  ".pdf": "application/pdf",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".doc": "application/msword",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".ppt": "application/vnd.ms-powerpoint",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".mp4": "video/mp4",
  ".mp3": "audio/mpeg",
};

function loguer(contexte: string, error: unknown) {
  const message =
    error instanceof Error ? error.message : (error as { message?: string })?.message;
  if (message) console.error(`[import] ${contexte} :`, message);
}

function extensionDe(nom: string): string {
  const i = nom.lastIndexOf(".");
  return i === -1 ? "" : nom.slice(i).toLowerCase();
}

function mimePour(fichier: File): string | null {
  const ext = extensionDe(fichier.name);
  return MIMES_SUPPORTS[ext] ?? null;
}

function nomSur(nom: string): string {
  return nom
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .slice(0, 100);
}

/**
 * Téléverse un fichier dans le bucket « supports » et le trace dans
 * `sources`. Retourne le chemin et l'identifiant de la source.
 */
async function stockerFichier(
  supabase: Awaited<ReturnType<typeof createClient>>,
  params: {
    organizationId: string;
    ownerId: string;
    fichier: File;
    mime: string;
    sousDossier: string;
  }
): Promise<{ chemin: string; sourceId: string } | { erreur: string }> {
  const chemin = `org/${params.organizationId}/${params.sousDossier}/${randomUUID()}-${nomSur(params.fichier.name)}`;
  const contenu = Buffer.from(await params.fichier.arrayBuffer());

  const { error: erreurStockage } = await supabase.storage
    .from("supports")
    .upload(chemin, contenu, { contentType: params.mime, upsert: false });
  if (erreurStockage) {
    loguer("stockage", erreurStockage);
    return {
      erreur:
        "Le téléversement a échoué. Vérifiez que la migration 0008 est appliquée (bucket « supports ») et réessayez.",
    };
  }

  const { data: source, error: erreurSource } = await supabase
    .from("sources")
    .insert({
      organization_id: params.organizationId,
      owner_id: params.ownerId,
      title: params.fichier.name,
      file_path: chemin,
      mime_type: params.mime,
      source_type: "support_pedagogique",
    })
    .select("id")
    .single();
  if (erreurSource || !source) {
    loguer("traçabilité source", erreurSource);
    await supabase.storage.from("supports").remove([chemin]);
    return { erreur: "L'enregistrement du document a échoué. Réessayez." };
  }

  return { chemin, sourceId: source.id };
}

/** Crée une activité « support » rattachée à une leçon. */
async function creerActiviteSupport(
  supabase: Awaited<ReturnType<typeof createClient>>,
  params: {
    lessonId: string;
    titre: string;
    chemin: string;
    mime: string;
    sourceId: string;
  }
) {
  const { count } = await supabase
    .from("activities")
    .select("id", { count: "exact", head: true })
    .eq("lesson_id", params.lessonId);

  return supabase.from("activities").insert({
    lesson_id: params.lessonId,
    type: "file",
    title: params.titre,
    content: {
      file_path: params.chemin,
      mime_type: params.mime,
      source_id: params.sourceId,
    },
    position: (count ?? 0) + 1,
    status: "draft",
  });
}

// ------------------------------------------------------------
// Import d'un document de cours → formation en brouillon
// ------------------------------------------------------------

export async function importerDocument(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await getCurrentUser();
  if (!user) return { error: "Vous devez être connecté." };

  const organizationId = String(formData.get("organization_id") ?? "");
  const titreSaisi = String(formData.get("title") ?? "").trim();
  const fichier = formData.get("file");

  if (!organizationId) return { error: "Veuillez choisir une organisation." };
  if (!(fichier instanceof File) || fichier.size === 0) {
    return { error: "Veuillez choisir le document de cours à importer." };
  }
  if (fichier.size > TAILLE_MAX) {
    return { error: "Le fichier dépasse 20 Mo. Réduisez-le ou découpez-le." };
  }
  if (!canCreateCourse(user.memberships, organizationId)) {
    return { error: "Vous n'avez pas le droit de créer une formation dans cette organisation." };
  }

  const ext = extensionDe(fichier.name);
  if (ext !== ".docx" && ext !== ".pdf") {
    return {
      error:
        "Formats acceptés pour l'import automatique : Word (.docx) ou PDF. Les autres formats peuvent être ajoutés comme supports dans l'éditeur.",
    };
  }

  // 1. Extraction du contenu (texte balisé pour l'IA + découpage
  // par titres, qui sert de mode simple et de repli).
  const mode = String(formData.get("mode") ?? "ia");
  const contenu = Buffer.from(await fichier.arrayBuffer());
  let texteBrut = "";
  let decoupage: Decoupage;
  try {
    if (ext === ".docx") {
      const { value: html } = await mammoth.convertToHtml({ buffer: contenu });
      texteBrut = htmlVersTexte(html);
      decoupage = decouperHtml(html);
    } else {
      const analyseur = new PDFParse({ data: contenu });
      try {
        const { text } = await analyseur.getText();
        texteBrut = text;
        decoupage = decouperTexte(text);
      } finally {
        await analyseur.destroy();
      }
    }
  } catch (e) {
    loguer("analyse du document", e);
    return {
      error:
        "Le document n'a pas pu être lu (fichier corrompu ou protégé ?). Vous pouvez quand même créer la formation manuellement et joindre le fichier en support.",
    };
  }

  const supabase = await createClient();

  // 2. Stockage du document original (traçabilité, PRD §17).
  const stocke = await stockerFichier(supabase, {
    organizationId,
    ownerId: user.id,
    fichier,
    mime: MIMES_SUPPORTS[ext],
    sousDossier: "imports",
  });
  if ("erreur" in stocke) return { error: stocke.erreur };

  // 2 bis. Structuration par IA (mode recommandé) : réorganisation
  // fidèle du contenu + extraction des QCM/exercices, tracée dans
  // ai_generations. En simulation, repli honnête sur les titres.
  let resultatIa: ResultatGeneration | null = null;
  let generationId: string | null = null;
  const avertissements: string[] = [];

  if (mode === "ia" && modeSimulation()) {
    avertissements.push(
      "Mode simulation actif : découpage par titres utilisé à la place de l'IA. Configurez un fournisseur IA (gratuit possible : LLM_PROVIDER=gemini) pour la structuration intelligente."
    );
  } else if (mode === "ia") {
    if (!iaConfiguree()) {
      return {
        error:
          "Aucune IA configurée. Dans .env.local : LLM_PROVIDER=gemini + LLM_API_KEY (gratuit), ou ANTHROPIC_API_KEY, ou ELITE_IA_MODE=simulation — ou choisissez le découpage par titres ci-dessous.",
      };
    }
    let texte = texteBrut;
    if (texte.length > MAX_TEXTE_IA) {
      texte = texte.slice(0, MAX_TEXTE_IA);
      avertissements.push(
        "Document très long : seuls les premiers ~120 000 caractères ont été analysés par l'IA. Découpez le document pour un import complet."
      );
    }

    const { data: generation } = await supabase
      .from("ai_generations")
      .insert({
        organization_id: organizationId,
        requested_by: user.id,
        generation_type: "document_structuring",
        brief: { fichier: fichier.name, mode: "import_ia" },
        context: { source: "import_document" },
        source_ids: [stocke.sourceId],
        prompt_version: PROMPT_VERSION_IMPORT,
        model_name: modeleConfigure(),
        status: "running",
      })
      .select("id")
      .single();
    generationId = generation?.id ?? null;

    const echecIa = async (message: string) => {
      if (generationId) {
        await supabase
          .from("ai_generations")
          .update({
            status: "failed",
            error_message: message,
            completed_at: new Date().toISOString(),
          })
          .eq("id", generationId);
      }
    };

    try {
      const reponse = await appelerLlm(
        SYSTEM_IMPORT,
        construirePromptStructuration(fichier.name, texte)
      );
      const analyse = validerResultat(extraireJson(reponse.texte));
      if (!analyse.ok) {
        await echecIa(analyse.erreur);
        return {
          error: `${analyse.erreur} Relancez l'import, ou choisissez le découpage par titres.`,
        };
      }
      resultatIa = analyse.resultat;
      if (generationId) {
        await supabase
          .from("ai_generations")
          .update({
            status: "succeeded",
            result: resultatIa as unknown as Record<string, unknown>,
            model_name: reponse.modele,
            input_tokens: reponse.inputTokens,
            output_tokens: reponse.outputTokens,
            completed_at: new Date().toISOString(),
          })
          .eq("id", generationId);
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : "Échec de l'appel au service IA.";
      loguer("structuration IA", e);
      await echecIa(message);
      return { error: `${message} Vous pouvez relancer, ou choisir le découpage par titres.` };
    }
  }

  // 3. Création de la formation en brouillon.
  const titre =
    titreSaisi ||
    resultatIa?.course.title ||
    fichier.name.replace(/\.(docx|pdf)$/i, "").replace(/[-_]+/g, " ").trim();
  const base = slugify(titre);
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

  const notes = [
    ...(resultatIa ? resultatIa.warnings : decoupage.warnings),
    ...avertissements,
  ];
  let description: string;
  if (resultatIa) {
    description = resultatIa.course.description || `Formation structurée par IA depuis « ${fichier.name} ».`;
    if (resultatIa.course.objectives.length > 0) {
      description += `\n\nObjectifs pédagogiques :\n${resultatIa.course.objectives
        .map((o) => `- ${o}`)
        .join("\n")}`;
    }
  } else {
    description = `Formation créée par import du document « ${fichier.name} ».`;
  }
  if (notes.length > 0) {
    description += `\n\nNotes d'import :\n${notes.map((w) => `- ${w}`).join("\n")}`;
  }

  const { data: course, error: erreurCourse } = await supabase
    .from("courses")
    .insert({
      organization_id: organizationId,
      owner_id: user.id,
      title: titre,
      slug,
      description,
      target_audience: resultatIa?.course.target_audience || null,
      prerequisites: resultatIa?.course.prerequisites || null,
      duration_minutes: resultatIa?.course.duration_minutes ?? null,
      context_type: "organization",
      format: "online",
      status: "draft",
    })
    .select("id")
    .single();
  if (erreurCourse || !course) {
    loguer("création de la formation", erreurCourse);
    return { error: "Le document est importé mais la formation n'a pas pu être créée." };
  }

  if (generationId) {
    await supabase
      .from("ai_generations")
      .update({ result_course_id: course.id })
      .eq("id", generationId);
  }

  const { data: version } = await supabase
    .from("course_versions")
    .insert({
      course_id: course.id,
      version_number: 1,
      change_summary: resultatIa
        ? `Importée et structurée par IA depuis « ${fichier.name} » (${PROMPT_VERSION_IMPORT})`
        : `Importée depuis « ${fichier.name} »`,
      created_by: user.id,
      status: "draft",
    })
    .select("id")
    .single();

  // 4. Modules, leçons — et, en mode IA, QCM extraits du document.
  let premiereLecon: string | null = null;
  if (version) {
    await supabase
      .from("courses")
      .update({ current_version_id: version.id })
      .eq("id", course.id);

    const modulesACreer = resultatIa
      ? resultatIa.modules.map((m) => ({
          title: m.title,
          description: m.description || null,
          lessons: m.lessons.map((l) => ({
            title: l.title,
            text: l.text,
            estimated_minutes: l.estimated_minutes,
            quiz: l.quiz,
          })),
        }))
      : decoupage.modules.map((m) => ({
          title: m.title,
          description: null as string | null,
          lessons: m.lessons.map((l) => ({
            title: l.title,
            text: l.text,
            estimated_minutes: null as number | null,
            quiz: null,
          })),
        }));

    for (const [i, mod] of modulesACreer.entries()) {
      const { data: moduleCree } = await supabase
        .from("modules")
        .insert({
          course_version_id: version.id,
          title: mod.title,
          description: mod.description,
          position: i + 1,
          status: "draft",
        })
        .select("id")
        .single();
      if (!moduleCree) continue;

      for (const [j, lecon] of mod.lessons.entries()) {
        const { data: leconCreee } = await supabase
          .from("lessons")
          .insert({
            module_id: moduleCree.id,
            title: lecon.title,
            content: { type: "text", text: lecon.text, imported: true },
            position: j + 1,
            estimated_minutes: lecon.estimated_minutes,
            status: "draft",
          })
          .select("id")
          .single();
        if (!leconCreee) continue;
        if (!premiereLecon) premiereLecon = leconCreee.id;

        // QCM détecté dans le document → activité quiz + questions.
        if (lecon.quiz) {
          const { data: activite } = await supabase
            .from("activities")
            .insert({
              lesson_id: leconCreee.id,
              type: "quiz",
              title: lecon.quiz.title,
              generated_by_ai: true,
              position: 1,
              status: "draft",
            })
            .select("id")
            .single();
          if (activite) {
            await supabase.from("questions").insert(
              lecon.quiz.questions.map((q, k) => ({
                activity_id: activite.id,
                type: "qcm",
                prompt: q.prompt,
                options: q.options,
                expected_answer: { index: q.correct_index },
                explanation: q.explanation,
                position: k + 1,
              }))
            );
          }
        }
      }
    }
  }

  // 4 bis. Compétences identifiées par l'IA : réutiliser celles qui
  // existent déjà dans l'organisation, créer les autres, puis lier.
  if (resultatIa) {
    for (const comp of resultatIa.competencies) {
      const { data: existante } = await supabase
        .from("competencies")
        .select("id")
        .eq("organization_id", organizationId)
        .ilike("name", comp.name)
        .maybeSingle();

      let competencyId = existante?.id as string | undefined;
      if (!competencyId) {
        const { data: creee } = await supabase
          .from("competencies")
          .insert({
            organization_id: organizationId,
            name: comp.name,
            domain: comp.domain,
            description: comp.description || null,
          })
          .select("id")
          .single();
        competencyId = creee?.id;
      }
      if (competencyId) {
        await supabase.from("course_competencies").upsert(
          { course_id: course.id, competency_id: competencyId, target_level: comp.target_level },
          { onConflict: "course_id,competency_id" }
        );
      }
    }
  }

  // 5. Le document original reste joint en support de la première leçon.
  if (premiereLecon) {
    await creerActiviteSupport(supabase, {
      lessonId: premiereLecon,
      titre: `Document original — ${fichier.name}`,
      chemin: stocke.chemin,
      mime: MIMES_SUPPORTS[ext],
      sourceId: stocke.sourceId,
    });
  }

  revalidatePath("/catalogue");
  redirect(`/catalogue/${course.id}/modifier`);
}

// ------------------------------------------------------------
// Supports de leçon : téléverser / retirer (formation en brouillon)
// ------------------------------------------------------------

async function verifierEdition(courseId: string) {
  const user = await getCurrentUser();
  if (!user) return { erreur: "Vous devez être connecté." as const };
  const supabase = await createClient();
  const { data: course } = await supabase
    .from("courses")
    .select("id, organization_id, status")
    .eq("id", courseId)
    .maybeSingle();
  if (!course) return { erreur: "Formation introuvable ou non autorisée." as const };
  if (!isContentEditable(course.status as CourseStatus)) {
    return {
      erreur:
        "Les supports ne sont modifiables qu'en brouillon : repassez la formation en brouillon d'abord." as const,
    };
  }
  return { user, supabase, course };
}

export async function televerserSupport(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const courseId = String(formData.get("course_id") ?? "");
  const lessonId = String(formData.get("lesson_id") ?? "");
  const fichier = formData.get("file");

  if (!(fichier instanceof File) || fichier.size === 0) {
    return { error: "Veuillez choisir un fichier." };
  }
  if (fichier.size > TAILLE_MAX) {
    return { error: "Le fichier dépasse 20 Mo." };
  }
  const mime = mimePour(fichier);
  if (!mime) {
    return {
      error:
        "Format non pris en charge. Acceptés : PDF, Word, PowerPoint, Excel, texte, images (PNG/JPG/WebP), MP4, MP3.",
    };
  }

  const ctx = await verifierEdition(courseId);
  if ("erreur" in ctx) return { error: ctx.erreur };

  const stocke = await stockerFichier(ctx.supabase, {
    organizationId: ctx.course.organization_id,
    ownerId: ctx.user.id,
    fichier,
    mime,
    sousDossier: `courses/${courseId}`,
  });
  if ("erreur" in stocke) return { error: stocke.erreur };

  const { error } = await creerActiviteSupport(ctx.supabase, {
    lessonId,
    titre: fichier.name.replace(/\.[^.]+$/, ""),
    chemin: stocke.chemin,
    mime,
    sourceId: stocke.sourceId,
  });
  if (error) {
    loguer("activité support", error);
    return { error: "Le support est stocké mais n'a pas pu être rattaché à la leçon. Réessayez." };
  }

  revalidatePath(`/catalogue/${courseId}/modifier`);
  return { success: `Support « ${fichier.name} » ajouté à la leçon.` };
}

export async function supprimerSupport(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const courseId = String(formData.get("course_id") ?? "");
  const activityId = String(formData.get("activity_id") ?? "");

  const ctx = await verifierEdition(courseId);
  if ("erreur" in ctx) return { error: ctx.erreur };
  const { supabase } = ctx;

  const { data: activite } = await supabase
    .from("activities")
    .select("id, content")
    .eq("id", activityId)
    .maybeSingle();
  if (!activite) return { error: "Support introuvable." };

  const contenu = (activite.content ?? {}) as { file_path?: string; source_id?: string };

  const { error } = await supabase.from("activities").delete().eq("id", activityId);
  if (error) return { error: "La suppression a échoué. Vérifiez vos droits." };

  if (contenu.file_path) {
    await supabase.storage.from("supports").remove([contenu.file_path]);
  }
  if (contenu.source_id) {
    await supabase.from("sources").delete().eq("id", contenu.source_id);
  }

  revalidatePath(`/catalogue/${courseId}/modifier`);
  return { success: "Support retiré (fichier supprimé du stockage)." };
}

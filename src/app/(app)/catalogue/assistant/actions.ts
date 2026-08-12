"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/profile";
import { canCreateCourse, slugify } from "@/lib/courses/statuts";
import { appelerLlm, modeleConfigure, modeSimulation } from "@/lib/ai/client";
import { genererSimulation } from "@/lib/ai/simulation";
import {
  construirePromptPlan,
  PROMPT_VERSION,
  SYSTEM_PROMPT,
  type BriefGeneration,
} from "@/lib/ai/prompts";
import { extraireJson, validerResultat } from "@/lib/ai/schema";
import type { ActionState } from "@/app/(app)/catalogue/actions";

/**
 * Génération d'une formation complète (brouillon) depuis une trame courte.
 *
 * Parcours (architecture §11) : droits → traçabilité → appel LLM →
 * validation du résultat → création du brouillon → demande de validation
 * humaine. L'appel LLM s'exécute uniquement côté serveur.
 */
export async function genererFormation(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await getCurrentUser();
  if (!user) return { error: "Vous devez être connecté." };

  const organizationId = String(formData.get("organization_id") ?? "");
  const sujet = String(formData.get("sujet") ?? "").trim();

  if (!organizationId) return { error: "Veuillez choisir une organisation." };
  if (sujet.length < 10) {
    return {
      error:
        "Décrivez le besoin en quelques mots au minimum (sujet, public, résultat attendu).",
    };
  }
  if (!canCreateCourse(user.memberships, organizationId)) {
    return {
      error: "Vous n'avez pas le droit de créer une formation dans cette organisation.",
    };
  }

  const brief: BriefGeneration = {
    sujet,
    public_cible: String(formData.get("public_cible") ?? ""),
    secteur: String(formData.get("secteur") ?? ""),
    contexte: String(formData.get("contexte") ?? ""),
    duree: String(formData.get("duree") ?? ""),
    format: String(formData.get("format") ?? ""),
    niveau: String(formData.get("niveau") ?? ""),
    notions_obligatoires: String(formData.get("notions_obligatoires") ?? ""),
  };

  const supabase = await createClient();

  // 1. Traçabilité : enregistrer la demande avant l'appel.
  const { data: generation, error: erreurTrace } = await supabase
    .from("ai_generations")
    .insert({
      organization_id: organizationId,
      requested_by: user.id,
      generation_type: "course_plan",
      brief: brief as unknown as Record<string, unknown>,
      context: { source: "assistant_creation" },
      prompt_version: PROMPT_VERSION,
      model_name: modeleConfigure(),
      status: "running",
    })
    .select("id")
    .single();

  if (erreurTrace || !generation) {
    console.error("[ia] traçabilité impossible :", erreurTrace?.message);
    return { error: "La demande de génération n'a pas pu être enregistrée." };
  }

  const echec = async (message: string): Promise<ActionState> => {
    await supabase
      .from("ai_generations")
      .update({
        status: "failed",
        error_message: message,
        completed_at: new Date().toISOString(),
      })
      .eq("id", generation.id);
    return { error: message };
  };

  // 2. Appel du LLM (ou mode simulation : contenu de démonstration
  // clairement étiqueté, sans clé API — pour tester le pipeline).
  let texte: string;
  let modele: string;
  let inputTokens: number | null = null;
  let outputTokens: number | null = null;
  if (modeSimulation()) {
    texte = genererSimulation(brief);
    modele = "simulation-locale";
  } else {
    try {
      const reponse = await appelerLlm(SYSTEM_PROMPT, construirePromptPlan(brief));
      texte = reponse.texte;
      modele = reponse.modele;
      inputTokens = reponse.inputTokens;
      outputTokens = reponse.outputTokens;
    } catch (e) {
      return echec(e instanceof Error ? e.message : "Échec de l'appel au service de génération.");
    }
  }

  // 3. Validation stricte du résultat.
  const analyse = validerResultat(extraireJson(texte));
  if (!analyse.ok) {
    return echec(`${analyse.erreur} Relancez la génération.`);
  }
  const resultat = analyse.resultat;

  // 4. Création du brouillon : formation + version.
  const base = slugify(resultat.course.title);
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

  let description = resultat.course.description;
  if (resultat.course.objectives.length > 0) {
    description += `\n\nObjectifs pédagogiques :\n${resultat.course.objectives
      .map((o) => `- ${o}`)
      .join("\n")}`;
  }

  const { data: course, error: erreurCourse } = await supabase
    .from("courses")
    .insert({
      organization_id: organizationId,
      owner_id: user.id,
      title: resultat.course.title,
      slug,
      description,
      target_audience: resultat.course.target_audience || null,
      prerequisites: resultat.course.prerequisites || null,
      duration_minutes: resultat.course.duration_minutes,
      context_type: "generic",
      sector: brief.secteur?.trim() || null,
      format: "online",
      status: "draft",
    })
    .select("id")
    .single();

  if (erreurCourse || !course) {
    console.error("[ia] création de la formation :", erreurCourse?.message);
    return echec("Le contenu a été généré mais la formation n'a pas pu être créée.");
  }

  const { data: version } = await supabase
    .from("course_versions")
    .insert({
      course_id: course.id,
      version_number: 1,
      change_summary: `Générée par IA (${PROMPT_VERSION})`,
      created_by: user.id,
      status: "draft",
    })
    .select("id")
    .single();

  if (version) {
    await supabase
      .from("courses")
      .update({ current_version_id: version.id })
      .eq("id", course.id);

    // 5. Modules et leçons.
    for (const [i, mod] of resultat.modules.entries()) {
      const { data: moduleCree } = await supabase
        .from("modules")
        .insert({
          course_version_id: version.id,
          title: mod.title,
          description: mod.description || null,
          position: i + 1,
          status: "draft",
        })
        .select("id")
        .single();

      if (moduleCree && mod.lessons.length > 0) {
        await supabase.from("lessons").insert(
          mod.lessons.map((l, j) => ({
            module_id: moduleCree.id,
            title: l.title,
            content: { type: "text", text: l.text, generated_by_ai: true },
            position: j + 1,
            estimated_minutes: l.estimated_minutes,
            status: "draft",
          }))
        );
      }
    }
  }

  // 6. Compétences : réutiliser celles qui existent déjà (même nom,
  // même organisation), créer les autres, puis les lier.
  for (const comp of resultat.competencies) {
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
        {
          course_id: course.id,
          competency_id: competencyId,
          target_level: comp.target_level,
        },
        { onConflict: "course_id,competency_id" }
      );
    }
  }

  // 7. Clôturer la traçabilité.
  await supabase
    .from("ai_generations")
    .update({
      status: "succeeded",
      result: resultat as unknown as Record<string, unknown>,
      result_course_id: course.id,
      model_name: modele,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      completed_at: new Date().toISOString(),
    })
    .eq("id", generation.id);

  revalidatePath("/catalogue");
  redirect(`/catalogue/${course.id}/modifier`);
}

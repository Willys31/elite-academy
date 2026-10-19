"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/profile";
import { canCreateCourse, slugify } from "@/lib/courses/statuts";
import { appelerLlmJson, modeleConfigure, modeSimulation, traceIa } from "@/lib/ai/client";
import { lireEnv } from "@/lib/ai/env";
import { genererSimulation } from "@/lib/ai/simulation";
import { type BriefGeneration } from "@/lib/ai/prompts";
import { analyserVersionPromptPlan, promptPlan } from "@/lib/ai/prompts-plan-v2";
import {
  analyserModeExemples,
  BUDGET_EXEMPLES_DEFAUT,
  choisirExemples,
  formaterExemples,
} from "@/lib/ai/exemples/selection";
import {
  avertissementsEnTexte,
  bornesExercicesDepuis,
  controlerPlan,
  sujetEstCommercial,
} from "@/lib/ai/controle-pedagogique";
import { genererAvecReparation, type Verification } from "@/lib/ai/reparation";
import {
  extraireJson,
  validerResultat,
  type ActiviteGeneree,
  type ResultatGeneration,
} from "@/lib/ai/schema";
import type { ActionState } from "@/app/(app)/catalogue/actions";

/**
 * Génération d'une formation complète (brouillon) depuis une trame courte.
 *
 * Parcours (architecture §11) : droits → traçabilité → appel LLM →
 * validation du résultat → création du brouillon → demande de validation
 * humaine. L'appel LLM s'exécute uniquement côté serveur.
 *
 * Lot 25 : prompt méthodologique v2 (LLM_PROMPT_PLAN), exemples de
 * référence (LLM_EXEMPLES), contrôle pédagogique après génération et UNE
 * relance de réparation si des erreurs bloquantes subsistent. Le modèle
 * et le fournisseur sont ceux de la tâche « conception ».
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

  // Réglages du lot 25 : version de prompt, exemples, bornes d'exercices.
  const version = analyserVersionPromptPlan(lireEnv("LLM_PROMPT_PLAN"));
  const bornes = bornesExercicesDepuis(lireEnv);
  const exemples =
    version === "v2"
      ? choisirExemples(brief.secteur || brief.sujet, BUDGET_EXEMPLES_DEFAUT, {
          mode: analyserModeExemples(lireEnv("LLM_EXEMPLES")),
        })
      : [];
  const pp = promptPlan(version, { exemples: formaterExemples(exemples), bornes });
  const sujetCommercial = sujetEstCommercial(brief);

  const supabase = await createClient();

  // 1. Traçabilité : enregistrer la demande avant l'appel.
  const contexte: Record<string, unknown> = {
    source: "assistant_creation",
    ia: traceIa("conception"),
    prompt: { version: pp.version, exemples: exemples.map((e) => e.id), bornes, sujet_commercial: sujetCommercial },
  };
  const { data: generation, error: erreurTrace } = await supabase
    .from("ai_generations")
    .insert({
      organization_id: organizationId,
      requested_by: user.id,
      generation_type: "course_plan",
      brief: brief as unknown as Record<string, unknown>,
      context: contexte,
      prompt_version: pp.version,
      model_name: modeleConfigure("conception"),
      status: "running",
    })
    .select("id")
    .single();

  if (erreurTrace || !generation) {
    console.error("[ia] traçabilité impossible :", erreurTrace?.message);
    return { error: "La demande de génération n'a pas pu être enregistrée." };
  }

  const echec = async (message: string, complement: Record<string, unknown> = {}): Promise<ActionState> => {
    await supabase
      .from("ai_generations")
      .update({
        status: "failed",
        error_message: message,
        completed_at: new Date().toISOString(),
        ...complement,
      })
      .eq("id", generation.id);
    return { error: message };
  };

  // Vérification = structure (schéma) + contrôle pédagogique.
  const verifier = (json: unknown): Verification<ResultatGeneration> => {
    const analyse = validerResultat(json);
    if (!analyse.ok) {
      return { ok: false, erreurs: [{ code: "STRUCTURE_INVALIDE", chemin: "$", message: analyse.erreur }], avertissements: [] };
    }
    const controle = controlerPlan(analyse.resultat, { version, bornes, sujetCommercial });
    return controle.ok
      ? { ok: true, valeur: analyse.resultat, avertissements: controle.avertissements }
      : { ok: false, erreurs: controle.erreurs, avertissements: controle.avertissements };
  };

  // 2. Appel du LLM (ou mode simulation : contenu de démonstration
  // clairement étiqueté, sans clé API — pour tester le pipeline).
  let resultat: ResultatGeneration;
  let modele: string;
  let inputTokens: number | null = null;
  let outputTokens: number | null = null;
  let avertissementsControle: string[] = [];
  let reparation: Record<string, unknown> = { effectuee: false, appels: 1 };

  if (modeSimulation()) {
    modele = "simulation-locale";
    const v = verifier(extraireJson(genererSimulation(brief)));
    if (!v.ok) {
      return echec(`Simulation refusée par le contrôle pédagogique : ${v.erreurs.map((e) => e.message).join(" ")}`);
    }
    resultat = v.valeur;
    avertissementsControle = avertissementsEnTexte(v.avertissements);
  } else {
    let r: Awaited<ReturnType<typeof genererAvecReparation<ResultatGeneration>>>;
    try {
      r = await genererAvecReparation(
        (prompt) => appelerLlmJson(pp.system, prompt, { tache: "conception" }),
        pp.prompt(brief),
        verifier
      );
    } catch (e) {
      return echec(e instanceof Error ? e.message : "Échec de l'appel au service de génération.");
    }
    reparation = {
      effectuee: r.bilan.reparee,
      appels: r.bilan.appels,
      erreurs_initiales: r.bilan.erreursInitiales.map((e) => e.code),
    };
    if (!r.ok) {
      return echec(r.erreur, {
        model_name: r.bilan.modele,
        input_tokens: r.bilan.inputTokens,
        output_tokens: r.bilan.outputTokens,
        context: { ...contexte, reparation },
      });
    }
    resultat = r.valeur;
    modele = r.bilan.modele;
    inputTokens = r.bilan.inputTokens;
    outputTokens = r.bilan.outputTokens;
    avertissementsControle = avertissementsEnTexte(r.avertissements);
  }

  // Les avertissements du contrôle rejoignent ceux du modèle : visibles
  // du validateur humain dans l'éditeur (provenance IA).
  resultat.warnings = [...resultat.warnings, ...avertissementsControle].slice(0, 40);

  // 3. Compétences d'abord : réutiliser celles qui existent déjà (même
  // nom, même organisation), créer les autres. Leur identifiant sert
  // ensuite aux liens leçon/activité → compétence.
  const competenceIds = new Map<string, { id: string; target_level: string }>();
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
    if (competencyId) competenceIds.set(comp.name.trim().toLowerCase(), { id: competencyId, target_level: comp.target_level });
  }
  const idsDe = (noms: string[]) =>
    noms
      .map((n) => competenceIds.get(n.trim().toLowerCase()))
      .filter((x): x is { id: string; target_level: string } => Boolean(x));

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

  const { data: versionCours } = await supabase
    .from("course_versions")
    .insert({
      course_id: course.id,
      version_number: 1,
      change_summary: `Générée par IA (${pp.version})`,
      created_by: user.id,
      status: "draft",
    })
    .select("id")
    .single();

  if (versionCours) {
    await supabase
      .from("courses")
      .update({ current_version_id: versionCours.id })
      .eq("id", course.id);

    // 5. Modules, leçons et activités.
    for (const [i, mod] of resultat.modules.entries()) {
      const { data: moduleCree } = await supabase
        .from("modules")
        .insert({
          course_version_id: versionCours.id,
          title: mod.title,
          description: mod.description || null,
          position: i + 1,
          status: "draft",
        })
        .select("id")
        .single();
      if (!moduleCree) continue;

      for (const [j, l] of mod.lessons.entries()) {
        // Les activités sans quiz (exercice, étude de cas, simulation,
        // question ouverte) n'ont pas encore d'écran dédié : elles sont
        // conservées dans le contenu de la leçon ET rendues lisibles dans
        // son texte. Les quiz deviennent de vraies activités corrigées.
        const quiz = l.activities.filter((a) => a.type === "quiz" && a.questions.length > 0);
        const autres = l.activities.filter((a) => !(a.type === "quiz" && a.questions.length > 0));
        const { data: leconCreee } = await supabase
          .from("lessons")
          .insert({
            module_id: moduleCree.id,
            title: l.title,
            content: {
              type: "text",
              text: texteLeconAvecActivites(l.text, autres),
              generated_by_ai: true,
              prompt_version: pp.version,
              competency_refs: l.competency_refs,
              situation_type: l.situation_type,
              media_brief: l.media_brief,
              activities: autres,
            },
            position: j + 1,
            estimated_minutes: l.estimated_minutes,
            status: "draft",
          })
          .select("id")
          .single();
        if (!leconCreee) continue;

        for (const [k, a] of quiz.entries()) {
          const competences = idsDe(a.competency_refs.length > 0 ? a.competency_refs : l.competency_refs);
          const { data: activite } = await supabase
            .from("activities")
            .insert({
              lesson_id: leconCreee.id,
              type: "quiz",
              title: a.title,
              instructions: a.instructions || null,
              content: {
                generated_by_ai: true,
                prompt_version: pp.version,
                situation_type: a.situation_type,
                expected_outcome: a.expected_outcome,
                evaluation: a.evaluation,
                competency_refs: a.competency_refs,
                media_brief: a.media_brief,
              },
              difficulty: a.difficulty,
              position: k + 1,
              generated_by_ai: true,
              status: "draft",
            })
            .select("id")
            .single();
          if (!activite) continue;

          await supabase.from("questions").insert(
            a.questions.map((q, n) => ({
              activity_id: activite.id,
              type: "qcm",
              prompt: q.prompt,
              options: q.options,
              expected_answer: { index: q.correct_index },
              explanation: q.explanation,
              difficulty: a.difficulty,
              competency_id: competences[0]?.id ?? null,
              position: n + 1,
            }))
          );
          if (competences.length > 0) {
            await supabase.from("activity_competencies").upsert(
              competences.map((c) => ({
                activity_id: activite.id,
                competency_id: c.id,
                level: c.target_level,
                weight: 1,
              })),
              { onConflict: "activity_id,competency_id" }
            );
          }
        }
      }
    }
  }

  // 6. Lier les compétences à la formation.
  for (const comp of resultat.competencies) {
    const c = competenceIds.get(comp.name.trim().toLowerCase());
    if (!c) continue;
    await supabase.from("course_competencies").upsert(
      {
        course_id: course.id,
        competency_id: c.id,
        target_level: comp.target_level,
      },
      { onConflict: "course_id,competency_id" }
    );
  }

  // 7. Clôturer la traçabilité : modèle réellement utilisé, jetons des
  // appels additionnés, réparation éventuelle.
  await supabase
    .from("ai_generations")
    .update({
      status: "succeeded",
      result: resultat as unknown as Record<string, unknown>,
      result_course_id: course.id,
      model_name: modele,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      context: { ...contexte, reparation },
      completed_at: new Date().toISOString(),
    })
    .eq("id", generation.id);

  revalidatePath("/catalogue");
  redirect(`/catalogue/${course.id}/modifier`);
}

const LIBELLES_ACTIVITE: Record<string, string> = {
  exercise: "Exercice",
  case_study: "Étude de cas",
  simulation: "Simulation",
  open_question: "Question ouverte",
  quiz: "Quiz",
};

/** Texte de la leçon suivi des activités sans écran dédié, lisibles par tous. */
function texteLeconAvecActivites(texte: string, activites: ActiviteGeneree[]): string {
  if (activites.length === 0) return texte;
  const blocs = activites.map((a) => {
    const lignes = [`${LIBELLES_ACTIVITE[a.type] ?? "Activité"} — ${a.title}`];
    if (a.instructions) lignes.push(`Consigne : ${a.instructions}`);
    if (a.expected_outcome) lignes.push(`Résultat attendu : ${a.expected_outcome}`);
    if (a.evaluation) lignes.push(`Évaluation : ${a.evaluation}`);
    if (a.competency_refs.length > 0) lignes.push(`Compétence(s) : ${a.competency_refs.join(", ")}`);
    return lignes.join("\n");
  });
  return `${texte}\n\n— Activités —\n\n${blocs.join("\n\n")}`;
}

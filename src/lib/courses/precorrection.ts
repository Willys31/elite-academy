import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { appelerLlmJson, iaConfiguree, modeleConfigure, modeSimulation, traceIa } from "@/lib/ai/client";
import { lireEnv } from "@/lib/ai/env";
import { extraireJson } from "@/lib/ai/json";
import { construirePromptCorrection, PROMPT_VERSION_CORRECTION, SYSTEM_CORRECTION } from "@/lib/ai/prompts-correction";
import {
  lireQuotaPrecorrections,
  propositionIncertaine,
  pseudonymiser,
  quotaAtteint,
  reponseTropCourte,
  validerPrecorrection,
  type PropositionsCopie,
} from "@/lib/ai/precorrection";
import { simulerPrecorrection } from "@/lib/ai/simulation";
import { lireContenuActiviteRedigee } from "@/lib/courses/activites-redigees";
import { formationDeLActivite } from "@/lib/courses/maitrise";
import type { ResultatCorrection } from "@/lib/courses/progression";

/**
 * Pré-correction par l'IA d'une copie en attente (lot 26, étape D).
 *
 * Appelée côté serveur juste après l'enregistrement d'une tentative qui
 * contient des réponses rédigées (`soumettreQcm`). Jamais bloquante :
 * sans IA configurée, quota atteint ou erreur, la copie reste simplement
 * « à corriger » et le formateur travaille comme au lot 23.
 *
 * Ce qui part vers le modèle : consigne, résultat attendu, critères,
 * grille, compétence et la réponse PSEUDONYMISÉE. Jamais le nom,
 * l'e-mail ni l'identifiant de l'apprenant. Tâche `correction`
 * (classe interaction : réflexion coupée, fournisseur dédié possible).
 *
 * Ce qui est écrit : une ligne `attempt_ai_reviews` (réservée à
 * l'encadrement) et une trace `ai_generations` dont `result` ne porte
 * que la référence de la revue (l'apprenant lit ses propres lignes).
 * Rien dans `attempts.feedback` : c'est `noterTentative` qui y écrit la
 * décision humaine.
 */
export async function precorrigerTentative(params: {
  attemptId: string;
  userId: string;
  activityId: string;
}): Promise<{ ok: boolean; motif: string }> {
  const { attemptId, userId, activityId } = params;
  const simulation = modeSimulation();
  if (!simulation && !iaConfiguree("correction")) return { ok: false, motif: "IA non configurée" };

  const admin = createAdminClient();
  const cours = await formationDeLActivite(admin, activityId);
  if (!cours) return { ok: false, motif: "formation introuvable" };

  // Quota par organisation et par jour.
  const quota = lireQuotaPrecorrections(lireEnv);
  const debut = new Date();
  debut.setUTCHours(0, 0, 0, 0);
  const { count } = await admin
    .from("ai_generations")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", cours.organization_id)
    .eq("generation_type", "answer_precorrection")
    .gte("created_at", debut.toISOString());
  if (quotaAtteint(count ?? 0, quota)) return { ok: false, motif: `quota atteint (${quota} par jour)` };

  // Copie et questions ouvertes encore sans note.
  const [{ data: tentative }, { data: activite }, { data: profil }] = await Promise.all([
    admin.from("attempts").select("id, answers, feedback, status").eq("id", attemptId).maybeSingle(),
    admin.from("activities").select("id, type, title, instructions, content").eq("id", activityId).maybeSingle(),
    admin.from("profiles").select("full_name, email").eq("id", userId).maybeSingle(),
  ]);
  if (!tentative || !activite) return { ok: false, motif: "copie ou activité introuvable" };
  if (tentative.status !== "pending_review") return { ok: false, motif: "copie déjà notée" };
  const correction = tentative.feedback as ResultatCorrection | null;
  const enAttente = (correction?.details ?? []).filter((d) => d.type === "open" && d.correcte === null);
  if (enAttente.length === 0) return { ok: false, motif: "aucune réponse rédigée en attente" };

  const { data: questions } = await admin
    .from("questions")
    .select("id, prompt, expected_answer, competency_id, competency:competencies(name)")
    .eq("activity_id", activityId)
    .in("id", enAttente.map((d) => d.questionId));
  const parId = new Map((questions ?? []).map((q) => [q.id as string, q]));
  const { data: niveau } = await admin
    .from("course_competencies")
    .select("competency_id, target_level")
    .eq("course_id", cours.id);
  const niveauDe = new Map((niveau ?? []).map((n) => [n.competency_id as string, n.target_level as string]));

  const contenu = lireContenuActiviteRedigee(activite.content);
  const reponses = (tentative.answers ?? {}) as Record<string, unknown>;
  const identites = [profil?.full_name as string | undefined, profil?.email as string | undefined];

  // Trace avant l'appel (client d'administration : requested_by = l'apprenant).
  const { data: generation } = await admin
    .from("ai_generations")
    .insert({
      organization_id: cours.organization_id,
      requested_by: userId,
      generation_type: "answer_precorrection",
      brief: { attempt_id: attemptId, activity_id: activityId, questions: enAttente.length },
      context: { source: "soumission", ia: traceIa("correction"), course_id: cours.id },
      prompt_version: PROMPT_VERSION_CORRECTION,
      model_name: modeleConfigure("correction"),
      status: "running",
    })
    .select("id")
    .single();

  const propositions: PropositionsCopie = {};
  let modele = modeleConfigure("correction");
  let inputTokens: number | null = null;
  let outputTokens: number | null = null;
  const additionner = (a: number | null, b: number | null) => (a === null && b === null ? null : (a ?? 0) + (b ?? 0));

  try {
    for (const detail of enAttente) {
      const q = parId.get(detail.questionId);
      const reponseBrute = typeof reponses[detail.questionId] === "string" ? (reponses[detail.questionId] as string) : "";
      if (reponseTropCourte(reponseBrute)) {
        propositions[detail.questionId] = propositionIncertaine("Réponse vide ou trop courte pour être jugée par l'IA : à lire directement.");
        continue;
      }
      const attendu = ((q?.expected_answer ?? {}) as { rubric?: unknown }).rubric;
      const competence = q ? (Array.isArray(q.competency) ? q.competency[0] : q.competency) : null;
      const competencyId = (q?.competency_id as string | null | undefined) ?? undefined;
      const prompt = construirePromptCorrection({
        typeActivite: String(activite.type),
        titre: String(activite.title),
        consigne: q?.prompt ? String(q.prompt) : String(activite.instructions ?? ""),
        resultatAttendu: contenu.expected_outcome || null,
        criteres: contenu.evaluation || null,
        grille: typeof attendu === "string" ? attendu : null,
        competence: (competence as { name?: string } | null)?.name ?? null,
        niveauCible: competencyId ? (niveauDe.get(competencyId) ?? null) : null,
        reponse: pseudonymiser(reponseBrute.slice(0, 4000), identites),
      });

      let json: unknown;
      if (simulation) {
        json = extraireJson(simulerPrecorrection(reponseBrute, contenu.evaluation));
        modele = "simulation-locale";
      } else {
        const r = await appelerLlmJson(SYSTEM_CORRECTION, prompt, { tache: "correction" });
        json = r.json;
        modele = r.modele;
        inputTokens = additionner(inputTokens, r.inputTokens);
        outputTokens = additionner(outputTokens, r.outputTokens);
      }
      const v = validerPrecorrection(json);
      propositions[detail.questionId] = v.ok
        ? v.proposition
        : propositionIncertaine(`La proposition de l'IA n'était pas exploitable (${v.erreur}) : à lire directement.`);
    }

    const { data: revue, error: erreurRevue } = await admin
      .from("attempt_ai_reviews")
      .insert({
        attempt_id: attemptId,
        generation_id: generation?.id ?? null,
        model_name: modele,
        prompt_version: PROMPT_VERSION_CORRECTION,
        proposal: propositions,
      })
      .select("id")
      .single();
    if (erreurRevue) throw new Error(erreurRevue.message);

    if (generation) {
      await admin
        .from("ai_generations")
        .update({
          status: "succeeded",
          result: { review_id: revue?.id ?? null },
          model_name: modele,
          input_tokens: inputTokens,
          output_tokens: outputTokens,
          completed_at: new Date().toISOString(),
        })
        .eq("id", generation.id);
    }
    return { ok: true, motif: "proposition enregistrée" };
  } catch (e) {
    const message = e instanceof Error ? e.message : "échec de la pré-correction";
    console.error("[ia] pré-correction :", message);
    if (generation) {
      await admin
        .from("ai_generations")
        .update({ status: "failed", error_message: message, completed_at: new Date().toISOString() })
        .eq("id", generation.id);
    }
    return { ok: false, motif: message };
  }
}

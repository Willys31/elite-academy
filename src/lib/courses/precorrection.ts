import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { appelerLlmJson, iaConfiguree, modeleConfigure, modeSimulation, traceIa } from "@/lib/ai/client";
import { lireEnv } from "@/lib/ai/env";
import { extraireJson } from "@/lib/ai/json";
import { construirePromptCorrection, PROMPT_VERSION_CORRECTION, SYSTEM_CORRECTION } from "@/lib/ai/prompts-correction";
import {
  lireQuotaPrecorrections,
  propositionReponseInsuffisante,
  pseudonymiser,
  quotaAtteint,
  reponseTropCourte,
  validerPrecorrection,
  type PropositionsCopie,
} from "@/lib/ai/precorrection";
import { simulerPrecorrection } from "@/lib/ai/simulation";
import { lireContenuActiviteRedigee } from "@/lib/courses/activites-redigees";
import { decisionAutomatique, lireReglagesCorrectionAuto } from "@/lib/courses/correction-auto";
import { enregistrerNotes } from "@/lib/courses/correction";
import { formationDeLActivite } from "@/lib/courses/maitrise";
import type { ResultatCorrection } from "@/lib/courses/progression";

/** Au-delà, une génération « en cours » est considérée abandonnée et la correction peut être relancée. */
const DUREE_MAX_EN_COURS_MS = 10 * 60 * 1000;

export type ResultatCorrectionAutomatique =
  | { ok: true; motif: string; corrigee: { score: number; nbCorrectes: number; nbQuestions: number } }
  | { ok: false; motif: string; enCours?: boolean };

/**
 * Correction automatique d'une copie en attente (lot 26, étape D ;
 * lot 27 bis : entièrement automatique).
 *
 * Appelée côté serveur juste après l'enregistrement d'une tentative qui
 * contient des réponses rédigées (`soumettreQcm`), puis relancée depuis
 * la page de l'activité tant que la copie n'est pas notée
 * (`relancerCorrection`). La note est posée dès que chaque réponse a sa
 * correction : il n'y a ni seuil ni validation humaine. Si le service ne
 * répond pas, la copie reste « en cours de correction » et sera reprise
 * à la relance ; un formateur peut aussi la noter depuis sa file (repli).
 *
 * Ce qui part vers le modèle : consigne, résultat attendu, critères,
 * grille, compétence et la réponse PSEUDONYMISÉE. Jamais le nom,
 * l'e-mail ni l'identifiant de l'apprenant. Tâche `correction`
 * (classe interaction : réflexion coupée, fournisseur dédié possible).
 *
 * Ce qui est écrit : une ligne `attempt_ai_reviews` (réservée à
 * l'encadrement, une par copie), une trace `ai_generations` dont
 * `result` ne porte que la référence de la revue, puis la note via
 * `enregistrerNotes` (score, maîtrise, XP, notification).
 */
export async function corrigerTentativeAutomatiquement(params: {
  attemptId: string;
  userId: string;
  activityId: string;
}): Promise<ResultatCorrectionAutomatique> {
  const { attemptId, userId, activityId } = params;
  const simulation = modeSimulation();
  if (!simulation && !iaConfiguree("correction")) return { ok: false, motif: "correction automatique non configurée" };

  const admin = createAdminClient();
  const cours = await formationDeLActivite(admin, activityId);
  if (!cours) return { ok: false, motif: "formation introuvable" };

  // Copie et questions rédigées encore sans note.
  const [{ data: tentative }, { data: activite }, { data: profil }] = await Promise.all([
    admin.from("attempts").select("id, user_id, activity_id, session_id, answers, feedback, status").eq("id", attemptId).maybeSingle(),
    admin.from("activities").select("id, type, title, instructions, content").eq("id", activityId).maybeSingle(),
    admin.from("profiles").select("full_name, email").eq("id", userId).maybeSingle(),
  ]);
  if (!tentative || !activite) return { ok: false, motif: "copie ou activité introuvable" };
  if (tentative.status !== "pending_review") return { ok: false, motif: "copie déjà notée" };
  const correction = tentative.feedback as ResultatCorrection | null;
  const enAttente = (correction?.details ?? []).filter((d) => d.type === "open" && d.correcte === null);
  if (enAttente.length === 0) return { ok: false, motif: "aucune réponse rédigée en attente" };
  const idsEnAttente = enAttente.map((d) => d.questionId);

  const reglages = lireReglagesCorrectionAuto(lireEnv);
  const poserLaNote = async (propositions: PropositionsCopie): Promise<ResultatCorrectionAutomatique | null> => {
    const notes = decisionAutomatique(propositions, idsEnAttente);
    if (!notes) return null;
    const r = await enregistrerNotes({
      admin,
      tentative: {
        id: attemptId,
        user_id: tentative.user_id as string,
        activity_id: activityId,
        session_id: (tentative.session_id as string | null) ?? null,
        status: "pending_review",
        feedback: correction as ResultatCorrection,
      },
      notes,
      decidePar: null,
    });
    return r.ok
      ? { ok: true, motif: `corrigée automatiquement (${r.score} %)`, corrigee: { score: r.score, nbCorrectes: r.nbCorrectes, nbQuestions: r.nbQuestions } }
      : { ok: false, motif: `note automatique refusée : ${r.erreur}` };
  };

  // Une correction déjà préparée (relance après un échec de la note, ou
  // après une interruption) : on ne rappelle pas le modèle.
  const { data: revueExistante } = await admin.from("attempt_ai_reviews").select("id, proposal").eq("attempt_id", attemptId).maybeSingle();
  if (revueExistante && reglages.actif) {
    const posee = await poserLaNote((revueExistante.proposal ?? {}) as PropositionsCopie);
    if (posee) return posee;
  }

  // Une correction encore en cours (double envoi, relance pendant
  // l'appel) : on n'empile pas les appels au service.
  const depuis = new Date(Date.now() - DUREE_MAX_EN_COURS_MS).toISOString();
  const { count: nbEnCours } = await admin
    .from("ai_generations")
    .select("id", { count: "exact", head: true })
    .eq("generation_type", "answer_precorrection")
    .eq("status", "running")
    .gte("created_at", depuis)
    .contains("brief", { attempt_id: attemptId });
  if ((nbEnCours ?? 0) > 0) return { ok: false, motif: "correction déjà en cours", enCours: true };

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

  const { data: questions } = await admin
    .from("questions")
    .select("id, prompt, expected_answer, competency_id, competency:competencies(name)")
    .eq("activity_id", activityId)
    .in("id", idsEnAttente);
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
  // Jamais bloquante : sans trace, la correction se fait quand même.
  const { data: generation, error: erreurTrace } = await admin
    .from("ai_generations")
    .insert({
      organization_id: cours.organization_id,
      requested_by: userId,
      generation_type: "answer_precorrection",
      brief: { attempt_id: attemptId, activity_id: activityId, questions: enAttente.length },
      context: { source: revueExistante ? "relance" : "soumission", ia: traceIa("correction"), course_id: cours.id },
      prompt_version: PROMPT_VERSION_CORRECTION,
      model_name: modeleConfigure("correction"),
      status: "running",
    })
    .select("id")
    .single();
  if (erreurTrace) console.error("[ia] trace de correction non enregistrée :", erreurTrace.message);

  const propositions: PropositionsCopie = {};
  let modele = modeleConfigure("correction");
  let inputTokens: number | null = null;
  let outputTokens: number | null = null;
  const additionner = (a: number | null, b: number | null) => (a === null && b === null ? null : (a ?? 0) + (b ?? 0));

  try {
    for (const detail of enAttente) {
      const q = parId.get(detail.questionId);
      const reponseBrute = typeof reponses[detail.questionId] === "string" ? (reponses[detail.questionId] as string) : "";
      // Réponse vide ou trop courte : non acquise, sans appel au service.
      if (reponseTropCourte(reponseBrute)) {
        propositions[detail.questionId] = propositionReponseInsuffisante();
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
      // Une correction inexploitable n'est pas une note : la copie reste
      // en cours et sera relancée.
      if (!v.ok) throw new Error(`correction inexploitable : ${v.erreur}`);
      propositions[detail.questionId] = v.proposition;
    }

    const { data: revue, error: erreurRevue } = await admin
      .from("attempt_ai_reviews")
      .upsert(
        {
          attempt_id: attemptId,
          generation_id: generation?.id ?? null,
          model_name: modele,
          prompt_version: PROMPT_VERSION_CORRECTION,
          proposal: propositions,
        },
        { onConflict: "attempt_id" }
      )
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

    if (!reglages.actif) return { ok: false, motif: "correction automatique désactivée (CORRECTION_AUTO=off) : copie laissée à un formateur" };
    return (await poserLaNote(propositions)) ?? { ok: false, motif: "correction incomplète : à relancer" };
  } catch (e) {
    const message = e instanceof Error ? e.message : "échec de la correction automatique";
    console.error("[ia] correction automatique :", message);
    if (generation) {
      await admin
        .from("ai_generations")
        .update({ status: "failed", error_message: message, completed_at: new Date().toISOString() })
        .eq("id", generation.id);
    }
    return { ok: false, motif: message };
  }
}

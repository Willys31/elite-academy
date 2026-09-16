import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { appelerLlm, iaConfiguree, modeleConfigure, modeSimulation } from "@/lib/ai/client";
import { extraireJson } from "@/lib/ai/schema";
import {
  construirePromptAnalyseSession,
  PROMPT_VERSION_SESSION,
  SYSTEM_ANALYSE_SESSION,
} from "@/lib/ai/prompts";
import { simulerAnalyseSession } from "@/lib/ai/simulation";
import { validerAnalyseSession } from "@/lib/sessions/analyse";
import {
  parserTranscriptTexte,
  rapprocherLocuteurs,
  type SegmentTranscription,
} from "@/lib/sessions/tldv";
import { calculerPresence, presenceAvecJustification } from "@/lib/sessions/presence";
import { XP_FIXES } from "@/lib/gamification/xp";
import { attribuerXp, decernerBadge, incrementerCompteurs, verifierBadges } from "@/lib/gamification/moteur";
import { emettreNotification, emettreNotifications } from "@/lib/notifications/emettre";

/**
 * Moteur des sessions hybrides – côté serveur uniquement.
 *
 * - `cloturerEtCalculerPresences` : à la clôture, calcule le statut de
 *   présence de chaque participant (lib pure `calculerPresence`), crédite
 *   les points (présence, ponctualité, complétion, top 3), décerne les
 *   badges de session et notifie.
 * - `analyserTranscription` : lance l'analyse IA d'une transcription
 *   (webhook ou import), avec traçabilité `ai_generations`.
 *
 * Aucune fonction ne lève : les erreurs sont journalisées.
 */

type Admin = ReturnType<typeof createAdminClient>;

function loguer(operation: string, erreur: unknown) {
  if (erreur) console.error(`[sessions] ${operation}`, erreur);
}

function admin(): Admin | null {
  try {
    return createAdminClient();
  } catch (erreur) {
    loguer("client admin", erreur);
    return null;
  }
}

/** Limite de texte envoyé au LLM (≈ 30 000 jetons). */
const MAX_TEXTE_IA = 120_000;

// ------------------------------------------------------------
// Clôture
// ------------------------------------------------------------

export async function cloturerEtCalculerPresences(sessionId: string): Promise<void> {
  const client = admin();
  if (!client) return;

  const { data: session } = await client
    .from("live_sessions")
    .select("id, organization_id, course_id, title, starts_at, ends_at, closed_at")
    .eq("id", sessionId)
    .maybeSingle();
  if (!session) return;
  const cloturee = (session.closed_at as string) ?? new Date().toISOString();

  const [{ data: participants }, { data: tentatives }, { data: lancements }] = await Promise.all([
    client
      .from("session_participants")
      .select("id, user_id, joined_at, left_at, justification_status")
      .eq("session_id", sessionId)
      .order("joined_at"),
    client.from("attempts").select("user_id, activity_id, score").eq("session_id", sessionId),
    client.from("live_events").select("payload").eq("session_id", sessionId).eq("type", "activity_launched"),
  ]);

  const premiereArrivee = (participants ?? [])[0]?.joined_at as string | undefined;
  const activitesLancees = new Set(
    (lancements ?? [])
      .map((e) => (e.payload as { activity_id?: string | null })?.activity_id)
      .filter((a): a is string => typeof a === "string" && a.length > 0)
  );

  // Meilleur score par (participant, activité) → total par participant.
  const meilleurs = new Map<string, Map<string, number>>();
  for (const t of tentatives ?? []) {
    if (t.score === null) continue;
    const parActivite = meilleurs.get(t.user_id) ?? new Map<string, number>();
    const actuel = parActivite.get(t.activity_id) ?? -1;
    if (Number(t.score) > actuel) parActivite.set(t.activity_id, Number(t.score));
    meilleurs.set(t.user_id, parActivite);
  }
  const top3 = [...meilleurs.entries()]
    .map(([userId, m]) => ({ userId, total: [...m.values()].reduce((a, b) => a + b, 0) }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 3)
    .map((t) => t.userId);

  const notifications: Parameters<typeof emettreNotifications>[0] = [];

  for (const p of participants ?? []) {
    const userId = p.user_id as string;
    const entree = {
      debutPrevu: (session.starts_at as string) ?? null,
      finPrevue: (session.ends_at as string) ?? null,
      cloturee,
      arrivee: (p.joined_at as string) ?? null,
      depart: (p.left_at as string) ?? null,
      premiereArrivee: premiereArrivee ?? null,
    };
    const presence =
      p.justification_status === "accepted" ? presenceAvecJustification(entree) : calculerPresence(entree);

    let xp = 0;
    if (presence.xp.presence > 0) {
      xp += await attribuerXp({
        userId,
        organizationId: session.organization_id as string,
        type: "session_presence",
        montant: presence.xp.presence + presence.xp.penalite,
        referenceId: sessionId,
        courseId: (session.course_id as string) ?? null,
        sessionId,
        details: { statut: presence.statut, taux: presence.taux },
      });
    }
    if (presence.xp.ponctualite > 0) {
      xp += await attribuerXp({
        userId,
        organizationId: session.organization_id as string,
        type: "session_ponctualite",
        montant: presence.xp.ponctualite,
        referenceId: sessionId,
        courseId: (session.course_id as string) ?? null,
        sessionId,
      });
    }
    if (presence.statut !== "absent") {
      xp += await attribuerXp({
        userId,
        organizationId: session.organization_id as string,
        type: "session_completion",
        montant: XP_FIXES.session_completion,
        referenceId: sessionId,
        courseId: (session.course_id as string) ?? null,
        sessionId,
      });
      await incrementerCompteurs(userId, { sessions_presentes: 1 });
    }
    if (top3.includes(userId)) {
      xp += await attribuerXp({
        userId,
        organizationId: session.organization_id as string,
        type: "session_top3",
        montant: XP_FIXES.session_top3,
        referenceId: sessionId,
        courseId: (session.course_id as string) ?? null,
        sessionId,
        details: { rang: top3.indexOf(userId) + 1 },
      });
    }

    const repondu = meilleurs.get(userId);
    if (activitesLancees.size > 0 && repondu && [...activitesLancees].every((a) => repondu.has(a))) {
      await decernerBadge(userId, session.organization_id as string, "actif_session", sessionId, {
        course_id: session.course_id,
      });
    }
    await verifierBadges(userId, session.organization_id as string);

    await client
      .from("session_participants")
      .update({
        presence_status: presence.statut,
        punctuality_status: presence.ponctualite,
        presence_seconds: presence.dureeSecondes,
        xp_awarded: xp,
        attendance_status: p.left_at ? "left" : "present",
      })
      .eq("id", p.id);

    notifications.push({
      userId,
      organizationId: session.organization_id as string,
      type: "presence_confirmee",
      title: `Session « ${session.title} » terminée`,
      body: `Statut : ${presence.statut === "present" ? "Présent" : presence.statut === "partial" ? "Partiel" : presence.statut === "late" ? "En retard" : presence.statut === "left_early" ? "Parti en avance" : "Absent"}${xp > 0 ? ` · +${xp} XP` : ""}. Donnez votre avis sur la session.`,
      href: `/sessions/${sessionId}/participer`,
    });
  }

  if (top3[0] && activitesLancees.size > 0) {
    await decernerBadge(top3[0], session.organization_id as string, "roi_du_direct", sessionId, {
      course_id: session.course_id,
    });
  }
  await emettreNotifications(notifications);
}

/** Recalcule la présence d'un seul participant (justification traitée). */
export async function recalculerPresenceParticipant(participantId: string): Promise<void> {
  const client = admin();
  if (!client) return;
  const { data: p } = await client
    .from("session_participants")
    .select("id, user_id, joined_at, left_at, justification_status, session:live_sessions(organization_id, course_id, starts_at, ends_at, closed_at)")
    .eq("id", participantId)
    .maybeSingle();
  if (!p) return;
  const session = Array.isArray(p.session) ? p.session[0] : p.session;
  if (!session?.closed_at) return;

  const entree = {
    debutPrevu: (session.starts_at as string) ?? null,
    finPrevue: (session.ends_at as string) ?? null,
    cloturee: session.closed_at as string,
    arrivee: (p.joined_at as string) ?? null,
    depart: (p.left_at as string) ?? null,
  };
  const presence =
    p.justification_status === "accepted" ? presenceAvecJustification(entree) : calculerPresence(entree);
  await client
    .from("session_participants")
    .update({
      presence_status: presence.statut,
      punctuality_status: presence.ponctualite,
      presence_seconds: presence.dureeSecondes,
    })
    .eq("id", participantId);
}

// ------------------------------------------------------------
// Analyse IA d'une transcription
// ------------------------------------------------------------

/**
 * Analyse une transcription. `demandeurId` = formateur qui déclenche
 * (ligne `ai_generations` à son nom) ; null depuis le webhook (ligne au
 * nom du formateur animateur). Renvoie un message d'erreur, ou null.
 */
export async function analyserTranscription(
  transcriptId: string,
  demandeurId: string | null,
  options: { anonymiser?: boolean } = {}
): Promise<string | null> {
  const client = admin();
  if (!client) return "Configuration serveur incomplète.";

  const { data: transcript } = await client
    .from("meeting_transcripts")
    .select("id, session_id, transcript_text, segments, session:live_sessions(id, organization_id, course_id, trainer_id, title, starts_at, ends_at, closed_at, course:courses(title))")
    .eq("id", transcriptId)
    .maybeSingle();
  if (!transcript) return "Transcription introuvable.";
  const session = Array.isArray(transcript.session) ? transcript.session[0] : transcript.session;
  if (!session) return "Session introuvable.";

  if (!iaConfiguree() && !modeSimulation()) {
    await client.from("live_sessions").update({ analysis_status: "pending" }).eq("id", session.id);
    return "Aucune configuration IA : l'analyse est mise en attente (voir .env.example).";
  }

  // Segments : ceux de tl;dv, sinon parsés depuis le texte.
  let segments = (transcript.segments as SegmentTranscription[] | null) ?? [];
  if (!Array.isArray(segments) || segments.length === 0) {
    segments = parserTranscriptTexte(transcript.transcript_text as string);
  }

  const [{ data: participants }, { data: formateur }] = await Promise.all([
    client
      .from("session_participants")
      .select("user_id, profile:profiles(full_name)")
      .eq("session_id", session.id),
    client.from("profiles").select("id, full_name").eq("id", session.trainer_id).maybeSingle(),
  ]);
  const personnes = (participants ?? []).map((p) => {
    const profil = Array.isArray(p.profile) ? p.profile[0] : p.profile;
    return { userId: p.user_id as string, fullName: (profil?.full_name as string) || "Apprenant" };
  });
  const formateurPersonne = formateur ? { userId: formateur.id as string, fullName: (formateur.full_name as string) || "Formateur" } : null;
  const rapprochements = rapprocherLocuteurs([...new Set(segments.map((s) => s.locuteur))], personnes, formateurPersonne);

  const dureeMinutes =
    session.starts_at && (session.ends_at || session.closed_at)
      ? Math.round((new Date((session.ends_at ?? session.closed_at) as string).getTime() - new Date(session.starts_at as string).getTime()) / 60_000)
      : null;
  const course = Array.isArray(session.course) ? session.course[0] : session.course;

  await client.from("live_sessions").update({ analysis_status: "running" }).eq("id", session.id);

  const { data: generation } = await client
    .from("ai_generations")
    .insert({
      organization_id: session.organization_id,
      requested_by: demandeurId ?? session.trainer_id,
      generation_type: "session_analysis",
      brief: { titre: session.title, anonymiser: Boolean(options.anonymiser) },
      context: { session_id: session.id, transcript_id: transcriptId, source: demandeurId ? "formateur" : "webhook" },
      prompt_version: PROMPT_VERSION_SESSION,
      model_name: modeleConfigure(),
      status: "running",
    })
    .select("id")
    .single();

  const echec = async (message: string) => {
    if (generation) {
      await client
        .from("ai_generations")
        .update({ status: "failed", error_message: message, completed_at: new Date().toISOString() })
        .eq("id", generation.id);
    }
    await client.from("live_sessions").update({ analysis_status: "failed" }).eq("id", session.id);
    return message;
  };

  let texteReponse: string;
  let modele = modeleConfigure();
  let inputTokens: number | null = null;
  let outputTokens: number | null = null;
  try {
    if (modeSimulation()) {
      texteReponse = simulerAnalyseSession({
        titre: session.title as string,
        formateur: formateurPersonne?.fullName ?? "Formateur",
        locuteurs: [...new Set(segments.map((s) => s.locuteur))],
        extraits: segments.slice(0, 6).map((s) => ({ locuteur: s.locuteur, texte: s.texte })),
      });
    } else {
      const texte = (transcript.transcript_text as string).slice(0, MAX_TEXTE_IA);
      const reponse = await appelerLlm(
        SYSTEM_ANALYSE_SESSION,
        construirePromptAnalyseSession({
          titre: session.title as string,
          formation: (course?.title as string) ?? null,
          dureeMinutes,
          formateur: formateurPersonne?.fullName ?? "Formateur",
          participants: personnes.map((p) => p.fullName),
          transcript: texte,
          anonymiser: Boolean(options.anonymiser),
        })
      );
      texteReponse = reponse.texte;
      modele = reponse.modele;
      inputTokens = reponse.inputTokens;
      outputTokens = reponse.outputTokens;
    }
  } catch (erreur) {
    loguer("appel LLM", erreur);
    return echec(erreur instanceof Error ? erreur.message : "L'analyse a échoué.");
  }

  const analyse = validerAnalyseSession(extraireJson(texteReponse));
  if (!analyse.ok) return echec(analyse.erreur);
  const r = analyse.resultat;

  // Observations : une par intervention, rapprochée d'une personne.
  const parLocuteur = new Map(rapprochements.map((x) => [x.locuteur.toLowerCase(), x]));
  await client.from("intervention_observations").delete().eq("transcript_id", transcriptId);
  if (r.interventions.length > 0) {
    const { error } = await client.from("intervention_observations").insert(
      r.interventions.map((i) => {
        const rap = parLocuteur.get(i.speaker.toLowerCase());
        return {
          session_id: session.id,
          transcript_id: transcriptId,
          user_id: rap?.userId ?? null,
          speaker_label: i.speaker,
          speaker_type: rap?.type ?? "unknown",
          start_seconds: i.start_seconds,
          end_seconds: i.end_seconds,
          snippet: i.snippet,
          intervention_type: i.type,
          quality_score: i.quality_score,
        };
      })
    );
    loguer("observations", error);
  }

  const { error: erreurTranscript } = await client
    .from("meeting_transcripts")
    .update({
      summary: r.summary,
      key_points: r.key_points,
      keywords: r.keywords,
      insights: r.insights,
      speakers: rapprochements,
      analysis_generation_id: generation?.id ?? null,
      analyzed_at: new Date().toISOString(),
    })
    .eq("id", transcriptId);
  loguer("enregistrement de l'analyse", erreurTranscript);

  if (generation) {
    await client
      .from("ai_generations")
      .update({
        status: "succeeded",
        result: r as unknown as Record<string, unknown>,
        model_name: modele,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        completed_at: new Date().toISOString(),
      })
      .eq("id", generation.id);
  }
  await client.from("live_sessions").update({ analysis_status: "done" }).eq("id", session.id);

  // Notifications : le formateur, puis les participants consentants.
  await emettreNotification({
    userId: session.trainer_id as string,
    organizationId: session.organization_id as string,
    type: "resume_disponible",
    title: `Le résumé de « ${session.title} » est disponible`,
    body: r.insights.recommendations_trainer[0] ?? null,
    href: `/sessions/${session.id}/bilan`,
  });
  const { data: consentants } = await client
    .from("session_participants")
    .select("user_id")
    .eq("session_id", session.id)
    .eq("recording_consent", true);
  await emettreNotifications(
    (consentants ?? []).map((p) => ({
      userId: p.user_id as string,
      organizationId: session.organization_id as string,
      type: "bilan_session" as const,
      title: `Résumé et points clés de « ${session.title} »`,
      body: r.key_points[0] ?? null,
      href: `/sessions/${session.id}/participer`,
    }))
  );

  return null;
}

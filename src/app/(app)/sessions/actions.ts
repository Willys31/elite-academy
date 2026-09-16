"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/profile";
import { activeMemberships, isEliteAdmin } from "@/lib/auth/roles";
import {
  codeValide,
  genererCodeSession,
  normaliserCode,
} from "@/lib/sessions/sessions";
import { lirePortee, porteeExigeFormation } from "@/lib/partage/visibilite";
import { lireNote, SEUIL_DEPART_ANTICIPE_MS } from "@/lib/sessions/presence";
import { parserTranscriptTexte } from "@/lib/sessions/tldv";
import {
  analyserTranscription,
  cloturerEtCalculerPresences,
  recalculerPresenceParticipant,
} from "@/lib/sessions/moteur";
import { emettreNotification } from "@/lib/notifications/emettre";
import type { ActionState } from "@/app/(app)/catalogue/actions";

function loguer(contexte: string, error: { message?: string } | null | unknown) {
  if (error) console.error(`[sessions] ${contexte} :`, (error as { message?: string })?.message ?? error);
}

/** Rôles autorisés à animer une session dans une organisation. */
function peutAnimer(
  memberships: ReturnType<typeof activeMemberships>,
  organizationId: string,
  elite: boolean
): boolean {
  if (elite) return true;
  return memberships.some(
    (m) =>
      m.organization_id === organizationId &&
      ["admin", "designer", "trainer"].includes(m.role)
  );
}

// ------------------------------------------------------------
// Création d'une session
// ------------------------------------------------------------

export async function creerSession(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await getCurrentUser();
  if (!user) return { error: "Vous devez être connecté." };

  const organizationId = String(formData.get("organization_id") ?? "");
  const courseId = String(formData.get("course_id") ?? "");
  const title = String(formData.get("title") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const location = String(formData.get("location") ?? "").trim();
  const startsAt = String(formData.get("starts_at") ?? "");
  const endsAt = String(formData.get("ends_at") ?? "");
  const portee = lirePortee(formData.get("portee"));
  const recording = formData.get("recording_enabled") === "on";
  const tldvMeetingId = String(formData.get("tldv_meeting_id") ?? "").trim();

  if (!organizationId) return { error: "Veuillez choisir une organisation." };
  if (!title) return { error: "Veuillez saisir le titre de la session." };
  if (porteeExigeFormation(portee) && !courseId) {
    return { error: "Une session partagée au groupe doit être liée à une formation." };
  }
  if (startsAt && endsAt && new Date(endsAt) <= new Date(startsAt)) {
    return { error: "La fin doit être postérieure au début." };
  }

  const actives = activeMemberships(user.memberships);
  const elite = isEliteAdmin(user.memberships);
  if (!peutAnimer(actives, organizationId, elite)) {
    return { error: "Vous n'avez pas le droit d'animer une session dans cette organisation." };
  }

  const supabase = await createClient();
  const { data: org } = await supabase
    .from("organizations")
    .select("sector")
    .eq("id", organizationId)
    .maybeSingle();

  // Code unique : nouvelles tentatives en cas de collision.
  for (let essai = 0; essai < 5; essai++) {
    const code = genererCodeSession();
    const { data: session, error } = await supabase
      .from("live_sessions")
      .insert({
        organization_id: organizationId,
        course_id: courseId || null,
        trainer_id: user.id,
        title,
        description: description || null,
        location: location || null,
        session_code: code,
        starts_at: startsAt ? new Date(startsAt).toISOString() : null,
        ends_at: endsAt ? new Date(endsAt).toISOString() : null,
        visibility_scope: portee,
        sector: org?.sector ?? null,
        recording_enabled: recording,
        tldv_meeting_id: tldvMeetingId || null,
        status: "open",
      })
      .select("id")
      .single();

    if (!error && session) {
      redirect(`/sessions/${session.id}`);
    }
    if (error && error.code === "23505" && error.message?.includes("tldv")) {
      return { error: "Cet identifiant de réunion tl;dv est déjà utilisé par une autre session." };
    }
    if (error && error.code !== "23505") {
      loguer("création de session", error);
      return { error: "La création de la session a échoué. Réessayez plus tard." };
    }
    // 23505 = collision de code : on retente avec un nouveau code.
  }
  return { error: "Impossible de générer un code de session unique. Réessayez." };
}

// ------------------------------------------------------------
// Animation : lancer une activité, clôturer
// ------------------------------------------------------------

export async function lancerActivite(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await getCurrentUser();
  if (!user) return { error: "Vous devez être connecté." };

  const sessionId = String(formData.get("session_id") ?? "");
  const activityId = String(formData.get("activity_id") ?? "");
  const activityTitle = String(formData.get("activity_title") ?? "");

  const supabase = await createClient();
  const { error } = await supabase
    .from("live_sessions")
    .update({ current_activity_id: activityId || null })
    .eq("id", sessionId)
    .eq("status", "open");

  if (error) {
    loguer("lancement d'activité", error);
    return { error: "Le lancement a échoué. Vérifiez vos droits." };
  }

  await supabase.from("live_events").insert({
    session_id: sessionId,
    type: activityId ? "activity_launched" : "activity_stopped",
    payload: { activity_id: activityId || null, title: activityTitle || null },
    created_by: user.id,
  });

  revalidatePath(`/sessions/${sessionId}`);
  return {
    success: activityId
      ? `Activité lancée : les participants la voient maintenant sur leur appareil.`
      : "Activité arrêtée.",
  };
}

/**
 * Clôture : fige la session, puis le moteur calcule présences,
 * ponctualité, points et badges de chaque participant (lot 17).
 * `ends_at` reste la fin prévue ; `closed_at` est la clôture réelle.
 */
export async function cloturerSession(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await getCurrentUser();
  if (!user) return { error: "Vous devez être connecté." };

  const sessionId = String(formData.get("session_id") ?? "");
  const supabase = await createClient();
  const maintenant = new Date().toISOString();

  const { data: session, error } = await supabase
    .from("live_sessions")
    .update({ status: "closed", current_activity_id: null, closed_at: maintenant })
    .eq("id", sessionId)
    .eq("status", "open")
    .select("id, ends_at")
    .maybeSingle();

  if (error) {
    loguer("clôture", error);
    return { error: "La clôture a échoué. Vérifiez vos droits." };
  }
  if (!session) {
    return { error: "Cette session est déjà clôturée ou n'est pas visible." };
  }
  // Pas de fin prévue : la clôture en tient lieu (compatibilité avec
  // les écrans qui lisent `ends_at`).
  if (!session.ends_at) {
    await supabase.from("live_sessions").update({ ends_at: maintenant }).eq("id", sessionId);
  }

  await supabase.from("live_events").insert({
    session_id: sessionId,
    type: "session_closed",
    payload: {},
    created_by: user.id,
  });

  await cloturerEtCalculerPresences(sessionId);

  revalidatePath(`/sessions/${sessionId}`);
  revalidatePath(`/sessions/${sessionId}/bilan`);
  revalidatePath("/sessions");
  return { success: "Session clôturée. Présences, points et résultats sont calculés — voir le bilan." };
}

// ------------------------------------------------------------
// Suppression définitive d'une session
// ------------------------------------------------------------

/**
 * Supprime une session et, en cascade, ses présences
 * (`session_participants`), son journal d'événements (`live_events`),
 * ses avis et transcriptions.
 *
 * Les réponses aux QCM (`attempts`) ne sont pas rattachées à la
 * session : elles restent acquises à l'apprenant et alimentent
 * toujours sa progression. Supprimer une session efface donc la trace
 * de l'animation, pas les résultats pédagogiques.
 *
 * Le droit réel est appliqué par la politique RLS `sessions_delete`
 * (formateur animateur, administrateur de l'organisation, admin Elite).
 */
export async function supprimerSession(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await getCurrentUser();
  if (!user) return { error: "Vous devez être connecté." };

  const sessionId = String(formData.get("session_id") ?? "");
  if (!sessionId) return { error: "Session introuvable." };

  const supabase = await createClient();
  const { error, count } = await supabase
    .from("live_sessions")
    .delete({ count: "exact" })
    .eq("id", sessionId);

  if (error) {
    loguer("suppression", error);
    return { error: "La suppression a échoué. Vérifiez vos droits." };
  }
  // RLS ne renvoie pas d'erreur quand aucune ligne n'est visible : sans
  // ce contrôle, un refus de droits passerait pour un succès.
  if (count === 0) {
    return {
      error:
        "Suppression refusée : seul le formateur animateur ou un " +
        "administrateur de l'organisation peut supprimer cette session.",
    };
  }

  revalidatePath("/sessions");
  redirect("/sessions?supprimee=1");
}

// ------------------------------------------------------------
// Participant : rejoindre, quitter, justifier, donner son avis
// ------------------------------------------------------------

export async function rejoindreParCode(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await getCurrentUser();
  if (!user) return { error: "Vous devez être connecté." };

  const saisie = String(formData.get("code") ?? "");
  const consentement = formData.get("consent") === "on";
  if (!codeValide(saisie)) {
    return {
      error: "Code invalide : il comporte 6 lettres et chiffres (ex. : ABC234).",
    };
  }
  const code = normaliserCode(saisie);

  const supabase = await createClient();
  const { data: session } = await supabase
    .from("live_sessions")
    .select("id, status, title, recording_enabled")
    .eq("session_code", code)
    .maybeSingle();

  if (!session) {
    return {
      error:
        "Aucune session trouvée avec ce code. Vérifiez le code, ou demandez au formateur si la session appartient bien à votre organisation.",
    };
  }
  if (session.status !== "open") {
    return { error: `La session « ${session.title} » n'est pas ouverte.` };
  }
  /* Consentement explicite à l'enregistrement (addendum §10.1) : la
     case doit être cochée, mais on peut aussi refuser — la présence est
     alors enregistrée sans accès à la transcription. */
  const refus = formData.get("consent_refuse") === "on";
  if (session.recording_enabled && !consentement && !refus) {
    return {
      error:
        "Cette session est enregistrée et transcrite : cochez « J'accepte » ou « Je refuse l'enregistrement » avant de rejoindre.",
    };
  }

  const { error } = await supabase.from("session_participants").insert({
    session_id: session.id,
    user_id: user.id,
    attendance_status: "present",
    recording_consent: session.recording_enabled ? consentement : false,
  });

  if (error) {
    if (error.code === "23505") {
      // Déjà présent : retour dans la salle après un « Quitter ».
      // Un seul intervalle de présence est retenu (documenté).
      await supabase
        .from("session_participants")
        .update({ left_at: null, attendance_status: "present" })
        .eq("session_id", session.id)
        .eq("user_id", user.id);
    } else {
      loguer("présence", error);
      return { error: "L'enregistrement de votre présence a échoué. Réessayez." };
    }
  }

  // Les points de présence sont calculés à la clôture (lot 17), à
  // partir des heures réelles d'arrivée et de départ.
  redirect(`/sessions/${session.id}/participer`);
}

export async function quitterSession(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await getCurrentUser();
  if (!user) return { error: "Vous devez être connecté." };

  const sessionId = String(formData.get("session_id") ?? "");
  const supabase = await createClient();
  const maintenant = new Date();

  const { data: participation, error } = await supabase
    .from("session_participants")
    .update({ left_at: maintenant.toISOString(), attendance_status: "left" })
    .eq("session_id", sessionId)
    .eq("user_id", user.id)
    .is("left_at", null)
    .select("id, session:live_sessions(title, trainer_id, organization_id, ends_at, status)")
    .maybeSingle();
  if (error) {
    loguer("départ", error);
    return { error: "Votre départ n'a pas pu être enregistré." };
  }
  if (!participation) return { error: "Vous n'êtes pas (ou plus) dans cette session." };

  const session = Array.isArray(participation.session) ? participation.session[0] : participation.session;
  if (session?.status === "open" && session.ends_at) {
    const avance = new Date(session.ends_at as string).getTime() - maintenant.getTime();
    if (avance > SEUIL_DEPART_ANTICIPE_MS) {
      await emettreNotification({
        userId: session.trainer_id as string,
        organizationId: session.organization_id as string,
        type: "depart_anticipe",
        title: `${user.fullName || "Un participant"} a quitté « ${session.title} » avec ${Math.round(avance / 60_000)} min d'avance`,
        body: "Le participant pourra justifier son départ après la clôture ; vous déciderez alors de sa présence.",
        href: `/sessions/${sessionId}`,
      });
    }
  }

  revalidatePath(`/sessions/${sessionId}/participer`);
  revalidatePath(`/sessions/${sessionId}`);
  return { success: "Départ enregistré. Vous pouvez revenir avec le même code tant que la session est ouverte." };
}

export async function justifierDepart(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await getCurrentUser();
  if (!user) return { error: "Vous devez être connecté." };

  const sessionId = String(formData.get("session_id") ?? "");
  const justification = String(formData.get("justification") ?? "").trim();
  if (justification.length < 5 || justification.length > 300) {
    return { error: "Expliquez votre départ en 5 à 300 caractères." };
  }

  const supabase = await createClient();
  const { data: participation, error } = await supabase
    .from("session_participants")
    .update({ justification, justification_status: "pending" })
    .eq("session_id", sessionId)
    .eq("user_id", user.id)
    .is("justification_status", null)
    .select("id, session:live_sessions(title, trainer_id, organization_id)")
    .maybeSingle();
  if (error) {
    loguer("justification", error);
    return { error: "La justification n'a pas pu être envoyée." };
  }
  if (!participation) return { error: "Une justification a déjà été envoyée pour cette session." };

  const session = Array.isArray(participation.session) ? participation.session[0] : participation.session;
  if (session) {
    await emettreNotification({
      userId: session.trainer_id as string,
      organizationId: session.organization_id as string,
      type: "justification_traitee",
      title: `Justification de départ à traiter pour « ${session.title} »`,
      body: justification,
      href: `/sessions/${sessionId}/bilan`,
    });
  }
  revalidatePath(`/sessions/${sessionId}/participer`);
  return { success: "Justification transmise au formateur." };
}

export async function traiterJustification(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await getCurrentUser();
  if (!user) return { error: "Vous devez être connecté." };

  const participantId = String(formData.get("participant_id") ?? "");
  const decision = String(formData.get("decision") ?? "");
  if (!participantId || !["accepted", "refused"].includes(decision)) {
    return { error: "Décision invalide." };
  }

  const supabase = await createClient();
  const { data: p, error } = await supabase
    .from("session_participants")
    .update({ justification_status: decision, validated_by: user.id })
    .eq("id", participantId)
    .eq("justification_status", "pending")
    .select("id, user_id, session_id, session:live_sessions(title, organization_id)")
    .maybeSingle();
  if (error) {
    loguer("justification traitée", error);
    return { error: "La décision n'a pas pu être enregistrée. Vérifiez vos droits." };
  }
  if (!p) return { error: "Justification déjà traitée ou introuvable." };

  await recalculerPresenceParticipant(participantId);
  const session = Array.isArray(p.session) ? p.session[0] : p.session;
  await emettreNotification({
    userId: p.user_id as string,
    organizationId: session?.organization_id as string,
    type: "justification_traitee",
    title:
      decision === "accepted"
        ? `Votre départ de « ${session?.title} » est justifié`
        : `Votre justification pour « ${session?.title} » n'a pas été retenue`,
    body: decision === "accepted" ? "Votre présence a été recalculée comme si vous étiez resté jusqu'à la fin." : null,
    href: `/sessions/${p.session_id}/participer`,
  });

  revalidatePath(`/sessions/${p.session_id}/bilan`);
  return { success: decision === "accepted" ? "Justification acceptée, présence recalculée." : "Justification refusée." };
}

export async function donnerFeedbackSession(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await getCurrentUser();
  if (!user) return { error: "Vous devez être connecté." };

  const sessionId = String(formData.get("session_id") ?? "");
  const satisfaction = lireNote(formData.get("satisfaction_score"));
  const clarte = lireNote(formData.get("clarity_score"));
  const utilite = lireNote(formData.get("usefulness_score"));
  const commentaire = String(formData.get("comment") ?? "").trim().slice(0, 500);
  if (satisfaction === null || clarte === null || utilite === null) {
    return { error: "Donnez une note de 1 à 5 pour chacun des trois critères." };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("session_feedbacks").insert({
    session_id: sessionId,
    user_id: user.id,
    satisfaction_score: satisfaction,
    clarity_score: clarte,
    usefulness_score: utilite,
    comment: commentaire || null,
  });
  if (error) {
    if (error.code === "23505") return { error: "Vous avez déjà donné votre avis sur cette session." };
    loguer("avis", error);
    return { error: "Votre avis n'a pas pu être enregistré (la session doit être clôturée)." };
  }

  revalidatePath(`/sessions/${sessionId}/participer`);
  revalidatePath(`/sessions/${sessionId}/bilan`);
  return { success: "Merci pour votre avis : il aide le formateur à améliorer les prochaines sessions." };
}

// ------------------------------------------------------------
// Transcription : import manuel, identifiant tl;dv, analyse IA
// ------------------------------------------------------------

const MAX_TRANSCRIPT = 400_000;

export async function importerTranscription(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await getCurrentUser();
  if (!user) return { error: "Vous devez être connecté." };

  const sessionId = String(formData.get("session_id") ?? "");
  let texte = String(formData.get("texte") ?? "");
  const fichier = formData.get("fichier");
  if (fichier instanceof File && fichier.size > 0) {
    if (fichier.size > 5 * 1024 * 1024) return { error: "Le fichier dépasse 5 Mo." };
    texte = await fichier.text();
  }
  texte = texte.replace(/\r\n?/g, "\n").trim();
  if (texte.length < 50) return { error: "Collez ou importez une transcription d'au moins 50 caractères." };
  if (texte.length > MAX_TRANSCRIPT) return { error: "La transcription est trop longue (400 000 caractères maximum)." };

  const supabase = await createClient();
  const segments = parserTranscriptTexte(texte);
  const { data: transcript, error } = await supabase
    .from("meeting_transcripts")
    .insert({ session_id: sessionId, source: "manual", transcript_text: texte, segments })
    .select("id")
    .single();
  if (error || !transcript) {
    loguer("import de transcription", error);
    return { error: "L'import a échoué. Seul l'encadrement de la session peut importer une transcription." };
  }

  revalidatePath(`/sessions/${sessionId}/bilan`);
  return {
    success: `Transcription importée (${segments.length} prise${segments.length > 1 ? "s" : ""} de parole détectée${segments.length > 1 ? "s" : ""}). Lancez l'analyse quand vous le souhaitez.`,
  };
}

export async function definirIdentifiantTldv(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await getCurrentUser();
  if (!user) return { error: "Vous devez être connecté." };

  const sessionId = String(formData.get("session_id") ?? "");
  const meetingId = String(formData.get("tldv_meeting_id") ?? "").trim();
  const supabase = await createClient();
  const { error, count } = await supabase
    .from("live_sessions")
    .update({ tldv_meeting_id: meetingId || null, recording_enabled: true }, { count: "exact" })
    .eq("id", sessionId);
  if (error) {
    if (error.code === "23505") return { error: "Cet identifiant est déjà utilisé par une autre session." };
    loguer("identifiant tl;dv", error);
    return { error: "L'identifiant n'a pas pu être enregistré." };
  }
  if (count === 0) return { error: "Droits insuffisants sur cette session." };
  revalidatePath(`/sessions/${sessionId}/bilan`);
  return { success: meetingId ? "Identifiant enregistré : le webhook rattachera la transcription à cette session." : "Identifiant retiré." };
}

export async function lancerAnalyseTranscription(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await getCurrentUser();
  if (!user) return { error: "Vous devez être connecté." };

  const transcriptId = String(formData.get("transcript_id") ?? "");
  const anonymiser = formData.get("anonymiser") === "on";
  const supabase = await createClient();
  const { data: transcript } = await supabase
    .from("meeting_transcripts")
    .select("id, session_id, analyzed_at, session:live_sessions(analysis_status)")
    .eq("id", transcriptId)
    .maybeSingle();
  if (!transcript) return { error: "Transcription introuvable ou droits insuffisants." };
  const session = Array.isArray(transcript.session) ? transcript.session[0] : transcript.session;
  if (session?.analysis_status === "running") return { error: "Une analyse est déjà en cours." };
  if (transcript.analyzed_at) return { error: "Cette transcription a déjà été analysée." };

  const erreur = await analyserTranscription(transcriptId, user.id, { anonymiser });
  revalidatePath(`/sessions/${transcript.session_id}/bilan`);
  if (erreur) return { error: erreur };
  return { success: "Analyse terminée : résumé, points clés et recommandations sont disponibles." };
}

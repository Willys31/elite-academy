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
import type { ActionState } from "@/app/(app)/catalogue/actions";

function loguer(contexte: string, error: { message?: string } | null) {
  if (error) console.error(`[sessions] ${contexte} :`, error.message ?? error);
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
  const startsAt = String(formData.get("starts_at") ?? "");

  if (!organizationId) return { error: "Veuillez choisir une organisation." };
  if (!title) return { error: "Veuillez saisir le titre de la session." };

  const actives = activeMemberships(user.memberships);
  const elite = isEliteAdmin(user.memberships);
  if (!peutAnimer(actives, organizationId, elite)) {
    return { error: "Vous n'avez pas le droit d'animer une session dans cette organisation." };
  }

  const supabase = await createClient();

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
        session_code: code,
        starts_at: startsAt ? new Date(startsAt).toISOString() : null,
        status: "open",
      })
      .select("id")
      .single();

    if (!error && session) {
      redirect(`/sessions/${session.id}`);
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

export async function cloturerSession(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await getCurrentUser();
  if (!user) return { error: "Vous devez être connecté." };

  const sessionId = String(formData.get("session_id") ?? "");
  const supabase = await createClient();

  const { error } = await supabase
    .from("live_sessions")
    .update({
      status: "closed",
      current_activity_id: null,
      ends_at: new Date().toISOString(),
    })
    .eq("id", sessionId);

  if (error) {
    loguer("clôture", error);
    return { error: "La clôture a échoué. Vérifiez vos droits." };
  }

  await supabase.from("live_events").insert({
    session_id: sessionId,
    type: "session_closed",
    payload: {},
    created_by: user.id,
  });

  revalidatePath(`/sessions/${sessionId}`);
  revalidatePath("/sessions");
  return { success: "Session clôturée. Les résultats sont conservés." };
}

// ------------------------------------------------------------
// Participant : rejoindre par code
// ------------------------------------------------------------

export async function rejoindreParCode(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await getCurrentUser();
  if (!user) return { error: "Vous devez être connecté." };

  const saisie = String(formData.get("code") ?? "");
  if (!codeValide(saisie)) {
    return {
      error: "Code invalide : il comporte 6 lettres et chiffres (ex. : ABC234).",
    };
  }
  const code = normaliserCode(saisie);

  const supabase = await createClient();
  const { data: session } = await supabase
    .from("live_sessions")
    .select("id, status, title")
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

  const { error } = await supabase.from("session_participants").insert({
    session_id: session.id,
    user_id: user.id,
    attendance_status: "present",
  });

  // 23505 : déjà présent — pas un échec, on rejoint simplement.
  if (error && error.code !== "23505") {
    loguer("présence", error);
    return { error: "L'enregistrement de votre présence a échoué. Réessayez." };
  }

  redirect(`/sessions/${session.id}/participer`);
}

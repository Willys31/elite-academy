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
import { XP_FIXES } from "@/lib/gamification/xp";
import {
  attribuerXp,
  decernerBadge,
  incrementerCompteurs,
  verifierBadges,
} from "@/lib/gamification/moteur";
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

  const { data: session, error } = await supabase
    .from("live_sessions")
    .update({
      status: "closed",
      current_activity_id: null,
      ends_at: new Date().toISOString(),
    })
    .eq("id", sessionId)
    .eq("status", "open")
    .select("id, organization_id, course_id")
    .maybeSingle();

  if (error) {
    loguer("clôture", error);
    return { error: "La clôture a échoué. Vérifiez vos droits." };
  }
  if (!session) {
    return { error: "Cette session est déjà clôturée ou n'est pas visible." };
  }

  await supabase.from("live_events").insert({
    session_id: sessionId,
    type: "session_closed",
    payload: {},
    created_by: user.id,
  });

  await gamifierCloture(supabase, session);

  revalidatePath(`/sessions/${sessionId}`);
  revalidatePath("/sessions");
  return { success: "Session clôturée. Les résultats sont conservés." };
}

/**
 * Gamification de la clôture (lot 14) : chaque participant reçoit l'XP
 * de complétion ; les trois meilleurs scores de la session reçoivent le
 * bonus Top 3 ; « Actif en session » va à ceux qui ont répondu à toutes
 * les activités lancées, « Roi du direct » au premier.
 */
async function gamifierCloture(
  supabase: Awaited<ReturnType<typeof createClient>>,
  session: { id: string; organization_id: string; course_id: string | null }
) {
  const [{ data: participants }, { data: tentatives }, { data: lancements }] = await Promise.all([
    supabase.from("session_participants").select("user_id").eq("session_id", session.id),
    supabase
      .from("attempts")
      .select("user_id, activity_id, score")
      .eq("session_id", session.id),
    supabase
      .from("live_events")
      .select("payload")
      .eq("session_id", session.id)
      .eq("type", "activity_launched"),
  ]);

  const activitesLancees = new Set(
    (lancements ?? [])
      .map((e) => (e.payload as { activity_id?: string | null })?.activity_id)
      .filter((a): a is string => typeof a === "string" && a.length > 0)
  );

  // Meilleur score par (participant, activité), puis total par participant.
  const meilleurs = new Map<string, Map<string, number>>();
  for (const t of tentatives ?? []) {
    if (t.score === null) continue;
    const parActivite = meilleurs.get(t.user_id) ?? new Map<string, number>();
    const actuel = parActivite.get(t.activity_id) ?? -1;
    if (Number(t.score) > actuel) parActivite.set(t.activity_id, Number(t.score));
    meilleurs.set(t.user_id, parActivite);
  }
  const totaux = [...meilleurs.entries()]
    .map(([userId, parActivite]) => ({
      userId,
      total: [...parActivite.values()].reduce((a, b) => a + b, 0),
      nbActivites: parActivite.size,
    }))
    .sort((a, b) => b.total - a.total);
  const top3 = totaux.slice(0, 3).map((t) => t.userId);

  for (const p of participants ?? []) {
    const userId = p.user_id as string;
    await attribuerXp({
      userId,
      organizationId: session.organization_id,
      type: "session_completion",
      montant: XP_FIXES.session_completion,
      referenceId: session.id,
      courseId: session.course_id,
      sessionId: session.id,
    });
    if (top3.includes(userId)) {
      await attribuerXp({
        userId,
        organizationId: session.organization_id,
        type: "session_top3",
        montant: XP_FIXES.session_top3,
        referenceId: session.id,
        courseId: session.course_id,
        sessionId: session.id,
        details: { rang: top3.indexOf(userId) + 1 },
      });
    }
    const repondu = meilleurs.get(userId);
    if (
      activitesLancees.size > 0 &&
      repondu &&
      [...activitesLancees].every((a) => repondu.has(a))
    ) {
      await decernerBadge(userId, session.organization_id, "actif_session", session.id, {
        course_id: session.course_id,
      });
    }
  }
  if (top3[0] && activitesLancees.size > 0) {
    await decernerBadge(top3[0], session.organization_id, "roi_du_direct", session.id, {
      course_id: session.course_id,
    });
  }
}

// ------------------------------------------------------------
// Suppression définitive d'une session
// ------------------------------------------------------------

/**
 * Supprime une session et, en cascade, ses présences
 * (`session_participants`) et son journal d'événements
 * (`live_events`).
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
    .select("id, status, title, organization_id, course_id, starts_at")
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

  // Gamification (lot 14) : présence et ponctualité, une fois par
  // session (référence = session). Le lot 17 affinera à la clôture.
  if (!error) {
    const maintenant = Date.now();
    const debut = session.starts_at ? new Date(session.starts_at).getTime() : null;
    const ponctuel = debut === null || maintenant <= debut + 5 * 60_000;
    await attribuerXp({
      userId: user.id,
      organizationId: session.organization_id,
      type: "session_presence",
      montant: XP_FIXES.session_presence,
      referenceId: session.id,
      courseId: session.course_id,
      sessionId: session.id,
    });
    if (ponctuel) {
      await attribuerXp({
        userId: user.id,
        organizationId: session.organization_id,
        type: "session_ponctualite",
        montant: XP_FIXES.session_ponctualite,
        referenceId: session.id,
        courseId: session.course_id,
        sessionId: session.id,
      });
    }
    await incrementerCompteurs(user.id, { sessions_presentes: 1 });
    await verifierBadges(user.id, session.organization_id);
  }

  redirect(`/sessions/${session.id}/participer`);
}

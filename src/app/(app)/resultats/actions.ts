"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth/profile";
import { encadreUneOrganisation } from "@/lib/auth/roles";
import { appliquerNotes, type ResultatCorrection } from "@/lib/courses/progression";
import { estTestDePositionnement } from "@/lib/courses/positionnement";
import { formationDeLActivite, mettreAJourMaitrise } from "@/lib/courses/maitrise";
import type { NoteCorrecteur } from "@/lib/courses/questions";
import { ecartProposition, type PropositionsCopie } from "@/lib/ai/precorrection";
import { gamifierTentative, tentativesPrecedentes } from "@/lib/gamification/tentative";
import { emettreNotification } from "@/lib/notifications/emettre";
import type { ActionState } from "@/app/(app)/catalogue/actions";

function loguer(contexte: string, error: { message?: string } | null | unknown) {
  if (error) console.error(`[resultats] ${contexte} :`, (error as { message?: string }).message ?? error);
}

// ------------------------------------------------------------
// Correction humaine d'une tentative (questions ouvertes, lot 23)
// ------------------------------------------------------------

/**
 * Note les questions ouvertes d'une tentative en attente, recalcule le
 * score, met à jour la maîtrise et les points de l'apprenant, et le
 * prévient.
 *
 * Droits : la tentative doit être visible de l'appelant par RLS SANS
 * être la sienne — c'est exactement « j'encadre la formation »
 * (`oversees_activity`). L'écriture passe ensuite par le client
 * d'administration : `attempts` n'a aucune politique d'UPDATE.
 */
export async function noterTentative(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await getCurrentUser();
  if (!user) return { error: "Vous devez être connecté." };
  if (!encadreUneOrganisation(user.memberships)) {
    return { error: "La correction est réservée à l'encadrement de la formation." };
  }

  const attemptId = String(formData.get("attempt_id") ?? "");
  const supabase = await createClient();
  const { data: tentative } = await supabase
    .from("attempts")
    .select("id, user_id, activity_id, session_id, status, feedback, submitted_at")
    .eq("id", attemptId)
    .maybeSingle();
  if (!tentative) return { error: "Copie introuvable ou hors de votre encadrement." };
  if (tentative.user_id === user.id) {
    return { error: "Vous ne pouvez pas noter votre propre copie." };
  }
  if (tentative.status !== "pending_review") {
    return { error: "Cette copie a déjà été notée." };
  }

  const correctionInitiale = tentative.feedback as ResultatCorrection | null;
  if (!correctionInitiale || !Array.isArray(correctionInitiale.details)) {
    return { error: "Cette copie ne contient aucun détail à corriger." };
  }

  // Notes saisies : une par question ouverte (`note_<id>` = 1 / 0, `commentaire_<id>`).
  const notes: Record<string, NoteCorrecteur> = {};
  for (const d of correctionInitiale.details) {
    if (d.type !== "open" || d.correcte !== null) continue;
    const verdict = formData.get(`note_${d.questionId}`);
    if (verdict !== "1" && verdict !== "0") continue;
    notes[d.questionId] = {
      acquise: verdict === "1",
      commentaire: String(formData.get(`commentaire_${d.questionId}`) ?? "").trim().slice(0, 2000) || null,
    };
  }

  const { correction, sansNote } = appliquerNotes(correctionInitiale, notes);
  if (sansNote.length > 0) {
    return {
      error: `Indiquez « acquise » ou « non acquise » pour chaque question ouverte (${sansNote.length} sans note).`,
    };
  }
  const score = correction.scorePourcent ?? 0;

  const admin = createAdminClient();
  const { error: erreurMaj, count } = await admin
    .from("attempts")
    .update(
      {
        score,
        feedback: correction as unknown as Record<string, unknown>,
        status: "graded",
        graded_by: user.id,
        graded_at: new Date().toISOString(),
      },
      { count: "exact" }
    )
    .eq("id", tentative.id)
    .eq("status", "pending_review");
  if (erreurMaj || count === 0) {
    loguer("enregistrement de la note", erreurMaj);
    return { error: "La note n'a pas pu être enregistrée. Rechargez la page et réessayez." };
  }

  // Proposition de l'IA (lot 26) : conserver l'écart avec la décision
  // humaine pour mesurer, plus tard, la fiabilité de la pré-correction.
  const { data: revue } = await admin
    .from("attempt_ai_reviews")
    .select("id, proposal")
    .eq("attempt_id", tentative.id)
    .maybeSingle();
  if (revue) {
    const ecart = ecartProposition((revue.proposal ?? {}) as PropositionsCopie, notes);
    await admin
      .from("attempt_ai_reviews")
      .update({
        validated_as_is: ecart.validatedAsIs,
        final_verdicts: ecart.finalVerdicts,
        decided_by: user.id,
        decided_at: new Date().toISOString(),
      })
      .eq("id", revue.id);
  }

  // Formation de l'activité : c'est elle qui reçoit la maîtrise.
  const [cours, { data: activite }] = await Promise.all([
    formationDeLActivite(admin, tentative.activity_id as string),
    admin.from("activities").select("title, content").eq("id", tentative.activity_id).maybeSingle(),
  ]);
  const courseId = cours?.id ?? "";
  const placement = estTestDePositionnement(activite?.content);
  const apprenantId = tentative.user_id as string;
  const activityId = tentative.activity_id as string;

  const competencesMontees = await mettreAJourMaitrise({
    admin,
    userId: apprenantId,
    courseId,
    activityId,
    placement,
    scoreTentative: score,
  });

  // Points, badges, série : la copie notée devient une tentative comme
  // une autre, sans bonus de rapidité. Jamais pour un test de positionnement.
  let xp = 0;
  if (!placement) {
    const { scoresPrecedents, meilleurAvant } = await tentativesPrecedentes(
      admin,
      apprenantId,
      activityId,
      tentative.id as string
    );
    xp = await gamifierTentative({
      admin,
      userId: apprenantId,
      courseId,
      activityId,
      sessionId: (tentative.session_id as string | null) ?? null,
      attemptId: tentative.id as string,
      scorePourcent: score,
      nbQuestions: correction.nbQuestions,
      dureeSecondes: null,
      scoresPrecedents,
      meilleurAvant,
      competencesMontees,
    });
  }

  const hrefApprenant = courseId
    ? `/formations/${courseId}/activite/${activityId}`
    : tentative.session_id
      ? `/sessions/${tentative.session_id}/activite/${activityId}`
      : "/revision";
  await emettreNotification({
    userId: apprenantId,
    organizationId: cours?.organization_id ?? null,
    type: "copie_notee",
    title: `Copie notée : ${activite?.title ?? "activité"}`,
    body: `Score : ${score} % (${correction.nbCorrectes}/${correction.nbQuestions}).${
      xp > 0 ? ` +${xp} XP.` : ""
    } Le commentaire du formateur est visible sur l'activité et dans Ma révision.`,
    href: hrefApprenant,
  });

  revalidatePath("/resultats");
  revalidatePath("/resultats/corrections");
  revalidatePath(`/resultats/corrections/${tentative.id}`);
  revalidatePath(hrefApprenant);
  return {
    success: `Copie notée : ${score} % (${correction.nbCorrectes}/${correction.nbQuestions}). L'apprenant a été prévenu.`,
  };
}

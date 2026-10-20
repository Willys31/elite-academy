"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth/profile";
import { encadreUneOrganisation } from "@/lib/auth/roles";
import type { ResultatCorrection } from "@/lib/courses/progression";
import type { NoteCorrecteur } from "@/lib/courses/questions";
import { enregistrerNotes, type TentativeACorriger } from "@/lib/courses/correction";
import { estCorrigeeAutomatiquement, estRevisable, lireDecision, relectureDemandee } from "@/lib/courses/correction-auto";
import { formationDeLActivite } from "@/lib/courses/maitrise";
import { notifierEncadrementFormation } from "@/lib/notifications/emettre";
import type { ActionState } from "@/app/(app)/catalogue/actions";

/** Notes saisies : une par question rédigée (`note_<id>` = 1 / 0, `commentaire_<id>`). */
function lireNotes(formData: FormData, correction: ResultatCorrection, seulementEnAttente: boolean): Record<string, NoteCorrecteur> {
  const notes: Record<string, NoteCorrecteur> = {};
  for (const d of correction.details) {
    if (d.type !== "open") continue;
    if (seulementEnAttente && d.correcte !== null) continue;
    const verdict = formData.get(`note_${d.questionId}`);
    if (verdict !== "1" && verdict !== "0") continue;
    notes[d.questionId] = {
      acquise: verdict === "1",
      commentaire: String(formData.get(`commentaire_${d.questionId}`) ?? "").trim().slice(0, 2000) || null,
    };
  }
  return notes;
}

/**
 * Copie lue sous RLS par un membre de l'encadrement : visible sans être
 * la sienne (`oversees_activity`).
 */
async function copieEncadree(attemptId: string) {
  const user = await getCurrentUser();
  if (!user) return { error: "Vous devez être connecté." as const };
  if (!encadreUneOrganisation(user.memberships)) {
    return { error: "La correction est réservée à l'encadrement de la formation." as const };
  }
  const supabase = await createClient();
  const { data: tentative } = await supabase
    .from("attempts")
    .select("id, user_id, activity_id, session_id, status, feedback, submitted_at")
    .eq("id", attemptId)
    .maybeSingle();
  if (!tentative) return { error: "Copie introuvable ou hors de votre encadrement." as const };
  if (tentative.user_id === user.id) return { error: "Vous ne pouvez pas noter votre propre copie." as const };
  const correction = tentative.feedback as ResultatCorrection | null;
  if (!correction || !Array.isArray(correction.details)) {
    return { error: "Cette copie ne contient aucun détail à corriger." as const };
  }
  const copie: TentativeACorriger = {
    id: tentative.id as string,
    user_id: tentative.user_id as string,
    activity_id: tentative.activity_id as string,
    session_id: (tentative.session_id as string | null) ?? null,
    status: tentative.status as string,
    feedback: correction,
  };
  return { user, copie };
}

// ------------------------------------------------------------
// Correction humaine d'une copie en attente (lot 23, lot 26)
// ------------------------------------------------------------

export async function noterTentative(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const ctx = await copieEncadree(String(formData.get("attempt_id") ?? ""));
  if ("error" in ctx) return { error: ctx.error };
  const { user, copie } = ctx;
  if (copie.status !== "pending_review") return { error: "Cette copie a déjà été notée." };

  const r = await enregistrerNotes({
    admin: createAdminClient(),
    tentative: copie,
    notes: lireNotes(formData, copie.feedback, true),
    decidePar: user.id,
  });
  if (!r.ok) return { error: r.erreur };

  revalidatePath("/resultats");
  revalidatePath("/resultats/corrections");
  revalidatePath(`/resultats/corrections/${copie.id}`);
  revalidatePath(r.hrefApprenant);
  return { success: `Copie notée : ${r.score} % (${r.nbCorrectes}/${r.nbQuestions}). L'apprenant a été prévenu.` };
}

// ------------------------------------------------------------
// Révision d'une copie déjà notée (lot 27) : correction automatique
// contestée, ou simple second regard d'un formateur.
// ------------------------------------------------------------

export async function reviserTentative(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const ctx = await copieEncadree(String(formData.get("attempt_id") ?? ""));
  if ("error" in ctx) return { error: ctx.error };
  const { user, copie } = ctx;
  if (copie.status !== "graded") return { error: "Cette copie n'est pas encore notée : utilisez la correction." };
  if (!estRevisable(copie.feedback)) return { error: "Cette copie ne contient aucune réponse rédigée à réviser." };

  const notes = lireNotes(formData, copie.feedback, false);
  if (Object.keys(notes).length === 0) return { error: "Indiquez le verdict de chaque réponse rédigée." };

  const r = await enregistrerNotes({
    admin: createAdminClient(),
    tentative: copie,
    notes,
    decidePar: user.id,
    revision: true,
  });
  if (!r.ok) return { error: r.erreur };

  revalidatePath("/resultats");
  revalidatePath("/resultats/corrections");
  revalidatePath(`/resultats/corrections/${copie.id}`);
  revalidatePath(r.hrefApprenant);
  return { success: `Correction révisée : ${r.score} % (${r.nbCorrectes}/${r.nbQuestions}). L'apprenant a été prévenu.` };
}

// ------------------------------------------------------------
// Demande de relecture par l'apprenant (lot 27, cadre légal §15)
// ------------------------------------------------------------

export async function demanderRelecture(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await getCurrentUser();
  if (!user) return { error: "Vous devez être connecté." };
  const attemptId = String(formData.get("attempt_id") ?? "");

  const supabase = await createClient();
  const { data: tentative } = await supabase
    .from("attempts")
    .select("id, user_id, activity_id, status, feedback, activity:activities(title)")
    .eq("id", attemptId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!tentative) return { error: "Copie introuvable." };
  if (tentative.status !== "graded" || !estCorrigeeAutomatiquement(tentative.feedback)) {
    return { error: "Seule une réponse corrigée automatiquement peut faire l'objet d'une relecture." };
  }
  if (relectureDemandee(tentative.feedback)) return { error: "Une relecture est déjà demandée pour cette réponse." };

  const decision = lireDecision(tentative.feedback);
  const admin = createAdminClient();
  const feedback = tentative.feedback as Record<string, unknown>;
  const { error } = await admin
    .from("attempts")
    .update({ feedback: { ...feedback, decision: { ...decision, relecture: { demandee_le: new Date().toISOString() } } } })
    .eq("id", tentative.id);
  if (error) return { error: "La demande n'a pas pu être enregistrée. Réessayez." };

  const cours = await formationDeLActivite(admin, tentative.activity_id as string);
  const activite = Array.isArray(tentative.activity) ? tentative.activity[0] : tentative.activity;
  if (cours) {
    await notifierEncadrementFormation(cours.id, {
      type: "copie_a_corriger",
      title: `Relecture demandée : ${activite?.title ?? "activité"}`,
      body: `${user.fullName || "Un apprenant"} demande qu'un formateur relise sa réponse corrigée automatiquement.`,
      href: `/resultats/corrections/${tentative.id}`,
    });
  }
  revalidatePath("/resultats/corrections");
  if (cours) revalidatePath(`/formations/${cours.id}/activite/${tentative.activity_id}`);
  return { success: "Relecture demandée : un formateur va relire votre réponse et vous serez prévenu." };
}

"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth/profile";
import { encadreUneOrganisation } from "@/lib/auth/roles";
import type { ResultatCorrection } from "@/lib/courses/progression";
import type { NoteCorrecteur } from "@/lib/courses/questions";
import { enregistrerNotes, type TentativeACorriger } from "@/lib/courses/correction";
import { estRevisable } from "@/lib/courses/correction-auto";
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
// Repli : note humaine d'une copie dont la correction automatique n'a
// pas abouti (lot 23, lot 26 ; lot 27 bis : cas exceptionnel)
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
// Révision d'une copie déjà notée (lot 27) : second regard d'un
// formateur sur une correction automatique.
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

"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/profile";
import type { ActionState } from "@/app/(app)/catalogue/actions";

function loguer(contexte: string, error: { message?: string; code?: string } | null) {
  if (error) console.error(`[validation] ${contexte} :`, error.code ?? "", error.message ?? error);
}

/**
 * Supprime une ligne de l'historique des générations IA.
 *
 * Les décisions humaines rattachées (`ai_validations`) partent en
 * cascade. La formation issue de la génération n'est pas touchée :
 * `result_course_id` est en `on delete set null` dans l'autre sens, et
 * ici on ne supprime que la trace de l'appel au modèle, pas son
 * résultat. Purger l'historique ne doit jamais faire disparaître du
 * contenu pédagogique.
 *
 * Le droit réel est appliqué par la politique RLS `ai_gen_delete`
 * (administrateur ou concepteur de l'organisation, admin Elite).
 */
export async function supprimerGeneration(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await getCurrentUser();
  if (!user) return { error: "Vous devez être connecté." };

  const generationId = String(formData.get("generation_id") ?? "");
  if (!generationId) return { error: "Génération introuvable." };

  const supabase = await createClient();
  const { error, count } = await supabase
    .from("ai_generations")
    .delete({ count: "exact" })
    .eq("id", generationId);

  if (error) {
    loguer("suppression d'une génération", error);
    return { error: "La suppression a échoué. Vérifiez vos droits." };
  }
  // RLS ne renvoie pas d'erreur quand aucune ligne n'est visible : sans
  // ce contrôle, un refus de droits passerait pour un succès.
  if (count === 0) {
    return {
      error:
        "Suppression refusée : seul un administrateur ou un concepteur " +
        "de l'organisation concernée peut purger cette trace.",
    };
  }

  revalidatePath("/validation");
  return { success: "Trace de génération supprimée." };
}

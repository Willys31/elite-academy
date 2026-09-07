"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/profile";
import type { ActionState } from "@/app/(app)/catalogue/actions";

function loguer(contexte: string, error: { message?: string; code?: string } | null) {
  if (error) console.error(`[sources] ${contexte} :`, error.code ?? "", error.message ?? error);
}

/**
 * Supprime un document importé : la ligne `sources` et le fichier
 * correspondant dans le bucket « supports ».
 *
 * Refusé si le document sert encore de support à une leçon. Aucune clé
 * étrangère ne lie `activities.content->>source_id` à `sources` : la
 * base laisserait donc passer la suppression, et la leçon afficherait
 * un support dont le fichier a disparu. Le retrait se fait alors depuis
 * l'éditeur de la formation, qui nettoie les deux d'un seul geste.
 *
 * Le droit réel est appliqué par la politique RLS `sources_delete`
 * (administrateur ou concepteur de l'organisation, admin Elite).
 */
export async function supprimerSource(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await getCurrentUser();
  if (!user) return { error: "Vous devez être connecté." };

  const sourceId = String(formData.get("source_id") ?? "");
  if (!sourceId) return { error: "Document introuvable." };

  const supabase = await createClient();

  const { data: source } = await supabase
    .from("sources")
    .select("id, title, file_path")
    .eq("id", sourceId)
    .maybeSingle();
  if (!source) return { error: "Document introuvable ou non autorisé." };

  const { data: usages } = await supabase
    .from("activities")
    .select("id")
    .eq("type", "file")
    .filter("content->>source_id", "eq", sourceId)
    .limit(1);

  if (usages && usages.length > 0) {
    return {
      error:
        "Ce document sert de support à une leçon. Retirez-le depuis " +
        "l'éditeur de la formation : le fichier et sa trace y sont " +
        "supprimés ensemble.",
    };
  }

  const { error, count } = await supabase
    .from("sources")
    .delete({ count: "exact" })
    .eq("id", sourceId);

  if (error) {
    loguer("suppression d'une source", error);
    return { error: "La suppression a échoué. Vérifiez vos droits." };
  }
  // RLS ne renvoie pas d'erreur quand aucune ligne n'est visible : sans
  // ce contrôle, un refus de droits passerait pour un succès.
  if (count === 0) {
    return {
      error:
        "Suppression refusée : seul un administrateur ou un concepteur " +
        "de l'organisation concernée peut supprimer ce document.",
    };
  }

  // Le fichier part après la ligne : si le stockage échoue, il reste un
  // fichier orphelin (invisible, sans trace) plutôt qu'une trace
  // pointant vers un fichier absent.
  if (source.file_path) {
    const { error: erreurStockage } = await supabase.storage
      .from("supports")
      .remove([source.file_path]);
    loguer("retrait du fichier", erreurStockage);
  }

  revalidatePath("/sources");
  return { success: `Document « ${source.title} » supprimé.` };
}

"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/profile";
import type { ActionState } from "@/app/(app)/catalogue/actions";

/**
 * Actions de la cloche et de l'écran « Notifications ».
 *
 * La politique `notifications_update` (migration 0012) ne laisse
 * modifier que ses propres lignes ; le filtre `user_id` ci-dessous
 * n'est qu'un rappel explicite.
 */

function loguer(operation: string, erreur: unknown) {
  if (erreur) console.error(`[notifications] ${operation}`, erreur);
}

/** Revalide tout le cadre : la pastille vit dans la barre latérale. */
function revaliderCadre() {
  revalidatePath("/", "layout");
}

export async function marquerLue(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await getCurrentUser();
  if (!user) return { error: "Vous devez être connecté." };

  const id = String(formData.get("notification_id") ?? "");
  if (!id) return { error: "Notification introuvable." };

  const supabase = await createClient();
  const { error, count } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() }, { count: "exact" })
    .eq("id", id)
    .eq("user_id", user.id)
    .is("read_at", null);

  if (error) {
    loguer("marquage", error);
    return { error: "La notification n'a pas pu être marquée comme lue." };
  }
  if (count === 0) return {};

  revaliderCadre();
  return {};
}

export async function toutMarquerLu(
  _prev: ActionState,
  _formData: FormData
): Promise<ActionState> {
  const user = await getCurrentUser();
  if (!user) return { error: "Vous devez être connecté." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("user_id", user.id)
    .is("read_at", null);

  if (error) {
    loguer("marquage global", error);
    return { error: "Les notifications n'ont pas pu être marquées comme lues." };
  }

  revaliderCadre();
  return { success: "Toutes les notifications sont marquées comme lues." };
}

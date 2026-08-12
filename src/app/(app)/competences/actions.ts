"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/profile";
import { canManageCompetencies } from "@/lib/courses/statuts";
import type { ActionState } from "@/app/(app)/catalogue/actions";

export async function creerCompetence(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await getCurrentUser();
  if (!user) return { error: "Vous devez être connecté." };

  const name = String(formData.get("name") ?? "").trim();
  const domain = String(formData.get("domain") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const portee = String(formData.get("portee") ?? ""); // "globale" ou un id d'organisation

  if (!name) return { error: "Veuillez saisir le nom de la compétence." };
  if (!domain) return { error: "Veuillez indiquer le domaine (ex. : management, santé, banque…)." };

  const organizationId = portee === "globale" ? null : portee;
  if (!canManageCompetencies(user.memberships, organizationId)) {
    return { error: "Vous n'avez pas le droit de créer cette compétence." };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("competencies").insert({
    organization_id: organizationId,
    name,
    domain,
    description: description || null,
  });

  if (error) {
    return { error: "La création a échoué. Réessayez plus tard." };
  }

  revalidatePath("/competences");
  return { success: `Compétence « ${name} » créée.` };
}

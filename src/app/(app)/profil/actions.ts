"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/profile";
import type { AuthState } from "@/app/(auth)/actions";

/**
 * Actions de l'écran « Mon profil ».
 *
 * Deux garde-fous valables pour les deux actions :
 * - l'identité vient toujours de la session serveur, jamais du
 *   formulaire : un champ caché « user_id » serait modifiable par le
 *   navigateur ;
 * - la politique `profiles_update_self` (migration 0001) revérifie de
 *   toute façon en base que la ligne modifiée est bien celle de
 *   l'appelant. Les contrôles ci-dessous ne sont qu'un confort
 *   d'interface qui donne un message clair.
 */

function loguer(operation: string, erreur: unknown) {
  if (erreur) console.error(`[profil] ${operation}`, erreur);
}

export async function mettreAJourIdentite(
  _prev: AuthState,
  formData: FormData
): Promise<AuthState> {
  const user = await getCurrentUser();
  if (!user) return { error: "Vous devez être connecté." };

  const nom = String(formData.get("full_name") ?? "").trim();
  if (nom.length < 2) {
    return { error: "Veuillez saisir votre nom complet (2 caractères minimum)." };
  }
  if (nom.length > 120) {
    return { error: "Ce nom est trop long (120 caractères maximum)." };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("profiles")
    .update({ full_name: nom })
    .eq("id", user.id);

  if (error) {
    loguer("mise à jour du nom", error);
    return { error: "Votre nom n'a pas pu être enregistré. Réessayez." };
  }

  /* Le nom apparaît aussi dans le bloc utilisateur du cadre applicatif :
     revalider la seule page /profil laisserait l'ancien nom dans la
     barre latérale jusqu'à la navigation suivante. */
  revalidatePath("/", "layout");
  return { success: "Votre nom a été mis à jour." };
}

export async function changerMotDePasse(
  _prev: AuthState,
  formData: FormData
): Promise<AuthState> {
  const user = await getCurrentUser();
  if (!user) return { error: "Vous devez être connecté." };

  const motDePasse = String(formData.get("password") ?? "");
  const confirmation = String(formData.get("confirm") ?? "");

  if (motDePasse.length < 8) {
    return { error: "Le mot de passe doit contenir au moins 8 caractères." };
  }
  if (motDePasse !== confirmation) {
    return { error: "Les deux mots de passe ne sont pas identiques." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password: motDePasse });
  if (error) {
    loguer("changement de mot de passe", error);
    return {
      error:
        "Le mot de passe n'a pas pu être modifié. Reconnectez-vous puis réessayez.",
    };
  }

  return {
    success:
      "Mot de passe modifié. Il sera demandé à votre prochaine connexion.",
  };
}

"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/profile";
import { fusionnerPreferences, validerPseudo } from "@/lib/profil/preferences";
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

/**
 * Préférences de classement (lot 14) : apparaître ou non dans les
 * classements de ses formations, et sous quel nom. Le filtrage réel se
 * fait dans la fonction SQL `classement_formation`, qui lit ces mêmes
 * préférences : l'écran ne peut pas « oublier » le masquage.
 */
export async function mettreAJourPreferencesClassement(
  _prev: AuthState,
  formData: FormData
): Promise<AuthState> {
  const user = await getCurrentUser();
  if (!user) return { error: "Vous devez être connecté." };

  const visible = formData.get("visible") === "on";
  const pseudo = validerPseudo(String(formData.get("pseudo") ?? ""));
  if (!pseudo.ok) return { error: pseudo.raison };

  const supabase = await createClient();
  const { data: profil } = await supabase
    .from("profiles")
    .select("preferences")
    .eq("id", user.id)
    .maybeSingle();

  const { error } = await supabase
    .from("profiles")
    .update({
      preferences: fusionnerPreferences(profil?.preferences, {
        classement: { visible, pseudo: pseudo.pseudo },
      }),
    })
    .eq("id", user.id);

  if (error) {
    loguer("préférences de classement", error);
    return { error: "Vos préférences n'ont pas pu être enregistrées. Réessayez." };
  }

  revalidatePath("/profil");
  revalidatePath("/classement");
  return {
    success: visible
      ? `Vous apparaissez dans les classements${pseudo.pseudo ? ` sous le nom « ${pseudo.pseudo} »` : " sous votre nom"}.`
      : "Vous n'apparaissez plus dans les classements.",
  };
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

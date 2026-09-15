"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/profile";
import { peutAdministrerOrganisation } from "@/lib/organisations/parametres";

export interface ParametresState {
  error?: string;
  success?: string;
}

/**
 * Actions de l'écran Paramètres.
 *
 * Chaque action revérifie le droit côté serveur AVANT d'écrire, alors
 * que la RLS le revérifierait de toute façon. Ce n'est pas redondant :
 * sans ce contrôle, une écriture refusée par la RLS ne lève aucune
 * erreur, elle touche simplement zéro ligne — l'utilisateur verrait un
 * message de succès pour un enregistrement qui n'a pas eu lieu. Le
 * piège a déjà été rencontré sur ce projet ; on vérifie donc en amont,
 * et on contrôle en aval le nombre de lignes réellement touchées.
 */

/** Renomme une organisation et met à jour son secteur. */
export async function enregistrerOrganisation(
  _prev: ParametresState,
  formData: FormData
): Promise<ParametresState> {
  const user = await getCurrentUser();
  if (!user) return { error: "Vous devez être connecté." };

  const organizationId = String(formData.get("organization_id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const sector = String(formData.get("sector") ?? "").trim();

  if (!organizationId) return { error: "Organisation inconnue." };
  if (!name) return { error: "Le nom de l'organisation est obligatoire." };
  if (name.length > 120) {
    return { error: "Le nom ne doit pas dépasser 120 caractères." };
  }
  if (!peutAdministrerOrganisation(user.memberships, organizationId)) {
    return { error: "Vous n'administrez pas cette organisation." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("organizations")
    .update({ name, sector: sector || null })
    .eq("id", organizationId)
    .select("id");

  if (error) {
    return { error: "L'enregistrement a échoué. Réessayez plus tard." };
  }
  // Zéro ligne touchée = refus silencieux de la RLS, pas un succès.
  if (!data || data.length === 0) {
    return { error: "Modification refusée : vos droits ont peut-être changé." };
  }

  revalidatePath("/parametres");
  revalidatePath("/organisations");
  return { success: "Organisation enregistrée." };
}

/** Ajoute une marque rattachée à l'organisation. */
export async function ajouterMarque(
  _prev: ParametresState,
  formData: FormData
): Promise<ParametresState> {
  const user = await getCurrentUser();
  if (!user) return { error: "Vous devez être connecté." };

  const organizationId = String(formData.get("organization_id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();

  if (!organizationId) return { error: "Organisation inconnue." };
  if (!name) return { error: "Veuillez saisir le nom de la marque." };
  if (!peutAdministrerOrganisation(user.memberships, organizationId)) {
    return { error: "Vous n'administrez pas cette organisation." };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("brands").insert({
    organization_id: organizationId,
    name,
    description: description || null,
  });

  if (error) {
    // La contrainte d'unicité (organisation, nom) est la seule que
    // l'utilisateur puisse déclencher : on la nomme au lieu de laisser
    // un message générique.
    if (error.code === "23505") {
      return { error: `La marque « ${name} » existe déjà dans cette organisation.` };
    }
    return { error: "La création de la marque a échoué. Réessayez plus tard." };
  }

  revalidatePath("/parametres");
  return { success: `Marque « ${name} » ajoutée.` };
}

/**
 * Archive une marque plutôt que de la supprimer.
 *
 * La suppression est autorisée en base, mais une marque peut déjà être
 * citée dans des formations ou des supports produits ; l'archivage la
 * retire de l'usage courant sans casser ce qui la référence.
 */
export async function archiverMarque(
  _prev: ParametresState,
  formData: FormData
): Promise<ParametresState> {
  const user = await getCurrentUser();
  if (!user) return { error: "Vous devez être connecté." };

  const organizationId = String(formData.get("organization_id") ?? "");
  const brandId = String(formData.get("brand_id") ?? "");

  if (!organizationId || !brandId) return { error: "Marque inconnue." };
  if (!peutAdministrerOrganisation(user.memberships, organizationId)) {
    return { error: "Vous n'administrez pas cette organisation." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("brands")
    .update({ status: "archived" })
    .eq("id", brandId)
    .eq("organization_id", organizationId)
    .select("id");

  if (error) return { error: "L'archivage a échoué. Réessayez plus tard." };
  if (!data || data.length === 0) {
    return { error: "Archivage refusé : vos droits ont peut-être changé." };
  }

  revalidatePath("/parametres");
  return { success: "Marque archivée." };
}

/** Remet une marque archivée en service. */
export async function reactiverMarque(
  _prev: ParametresState,
  formData: FormData
): Promise<ParametresState> {
  const user = await getCurrentUser();
  if (!user) return { error: "Vous devez être connecté." };

  const organizationId = String(formData.get("organization_id") ?? "");
  const brandId = String(formData.get("brand_id") ?? "");

  if (!organizationId || !brandId) return { error: "Marque inconnue." };
  if (!peutAdministrerOrganisation(user.memberships, organizationId)) {
    return { error: "Vous n'administrez pas cette organisation." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("brands")
    .update({ status: "active" })
    .eq("id", brandId)
    .eq("organization_id", organizationId)
    .select("id");

  if (error) return { error: "La réactivation a échoué. Réessayez plus tard." };
  if (!data || data.length === 0) {
    return { error: "Réactivation refusée : vos droits ont peut-être changé." };
  }

  revalidatePath("/parametres");
  return { success: "Marque réactivée." };
}

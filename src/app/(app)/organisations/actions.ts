"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth/profile";
import {
  canCreateOrganization,
  canManageMembers,
  type MemberRole,
} from "@/lib/auth/roles";

export interface OrgActionState {
  error?: string;
  success?: string;
}

const ROLES_VALIDES: MemberRole[] = [
  "admin",
  "designer",
  "trainer",
  "manager",
  "learner",
];

const TYPES_VALIDES = ["entreprise", "ecole", "centre_formation", "institution"];

/**
 * Créer une organisation.
 * Double contrôle : vérification serveur ici + politique RLS en base
 * (seul un administrateur Elite Experience peut insérer).
 */
export async function creerOrganisation(
  _prev: OrgActionState,
  formData: FormData
): Promise<OrgActionState> {
  const user = await getCurrentUser();
  if (!user) return { error: "Vous devez être connecté." };
  if (!canCreateOrganization(user.memberships)) {
    return { error: "Vous n'avez pas le droit de créer une organisation." };
  }

  const name = String(formData.get("name") ?? "").trim();
  const type = String(formData.get("type") ?? "");
  const sector = String(formData.get("sector") ?? "").trim();

  if (!name) return { error: "Veuillez saisir le nom de l'organisation." };
  if (!TYPES_VALIDES.includes(type)) {
    return { error: "Type d'organisation invalide." };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("organizations").insert({
    name,
    type,
    sector: sector || null,
  });

  if (error) {
    return {
      error:
        "La création a échoué. Vérifiez vos droits ou réessayez plus tard.",
    };
  }

  revalidatePath("/organisations");
  return { success: `Organisation « ${name} » créée.` };
}

/**
 * Ajouter un membre à une organisation à partir de son adresse e-mail.
 *
 * La recherche du profil par e-mail utilise le client d'administration
 * (service_role) car la RLS ne permet pas de lire le profil d'un
 * utilisateur d'une autre organisation. Le droit de l'appelant est donc
 * vérifié explicitement AVANT toute lecture ou écriture.
 */
export async function ajouterMembre(
  _prev: OrgActionState,
  formData: FormData
): Promise<OrgActionState> {
  const user = await getCurrentUser();
  if (!user) return { error: "Vous devez être connecté." };

  const organizationId = String(formData.get("organization_id") ?? "");
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const role = String(formData.get("role") ?? "") as MemberRole;

  if (!organizationId) return { error: "Organisation inconnue." };
  if (!email) return { error: "Veuillez saisir l'adresse e-mail du membre." };
  if (!ROLES_VALIDES.includes(role)) return { error: "Rôle invalide." };

  // Contrôle d'autorisation explicite côté serveur.
  if (!canManageMembers(user.memberships, organizationId)) {
    return {
      error: "Vous n'avez pas le droit de gérer les membres de cette organisation.",
    };
  }

  const admin = createAdminClient();

  const { data: profil, error: erreurProfil } = await admin
    .from("profiles")
    .select("id")
    .eq("email", email)
    .maybeSingle();

  if (erreurProfil) {
    return { error: "La recherche du compte a échoué. Réessayez plus tard." };
  }
  if (!profil) {
    return {
      error:
        "Aucun compte n'existe avec cette adresse. La personne doit d'abord créer son compte via l'écran d'inscription.",
    };
  }

  const { error } = await admin.from("organization_members").upsert(
    {
      organization_id: organizationId,
      user_id: profil.id,
      role,
      status: "active",
    },
    { onConflict: "organization_id,user_id" }
  );

  if (error) {
    return { error: "L'ajout du membre a échoué. Réessayez plus tard." };
  }

  revalidatePath(`/organisations/${organizationId}`);
  return { success: "Membre ajouté ou mis à jour." };
}

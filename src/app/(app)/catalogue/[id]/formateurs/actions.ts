"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/profile";
import { isEliteAdmin } from "@/lib/auth/roles";
import { roleInOrg } from "@/lib/courses/statuts";
import { peutAffecterFormateurs, peutEtreAffecte } from "@/lib/courses/affectations";
import type { AuthState } from "@/app/(auth)/actions";

/**
 * Affectation des formateurs à une formation.
 *
 * Les deux actions vérifient les droits côté serveur avant d'écrire,
 * puis la politique `course_trainers_insert` / `_delete` (migration
 * 0010) revérifie en base. Le double contrôle n'est pas redondant : le
 * premier donne un message clair, le second est celui qui protège.
 */

function loguer(operation: string, erreur: unknown) {
  if (erreur) console.error(`[affectation] ${operation}`, erreur);
}

/** Droits + organisation de la formation, ou message d'erreur. */
async function verifierAcces(courseId: string): Promise<
  | { ok: true; organizationId: string; userId: string }
  | { ok: false; error: string }
> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Vous devez être connecté." };
  if (!courseId) return { ok: false, error: "Formation introuvable." };

  const supabase = await createClient();
  const { data: formation } = await supabase
    .from("courses")
    .select("id, organization_id")
    .eq("id", courseId)
    .maybeSingle();

  if (!formation) {
    return { ok: false, error: "Cette formation est introuvable." };
  }

  const autorise = peutAffecterFormateurs(
    roleInOrg(user.memberships, formation.organization_id),
    isEliteAdmin(user.memberships)
  );
  if (!autorise) {
    return {
      ok: false,
      error:
        "Seuls l'administrateur et le responsable de l'organisation peuvent désigner les formateurs.",
    };
  }

  return {
    ok: true,
    organizationId: formation.organization_id as string,
    userId: user.id,
  };
}

export async function affecterFormateur(
  _prev: AuthState,
  formData: FormData
): Promise<AuthState> {
  const courseId = String(formData.get("course_id") ?? "");
  const cible = String(formData.get("user_id") ?? "");

  const acces = await verifierAcces(courseId);
  if (!acces.ok) return { error: acces.error };
  if (!cible) return { error: "Choisissez une personne à affecter." };

  const supabase = await createClient();

  /* On vérifie que la personne appartient bien à l'organisation de la
     formation ET qu'elle a un rôle capable d'animer. Sans ce contrôle,
     un identifiant bricolé dans le formulaire affecterait n'importe
     qui — la RLS accepterait, puisqu'elle ne juge que l'auteur du
     geste, pas sa cible. */
  const { data: membre } = await supabase
    .from("organization_members")
    .select("role, status")
    .eq("organization_id", acces.organizationId)
    .eq("user_id", cible)
    .maybeSingle();

  if (!membre || membre.status !== "active") {
    return {
      error: "Cette personne n'appartient pas à l'organisation de la formation.",
    };
  }
  if (!peutEtreAffecte(membre.role as string)) {
    return {
      error:
        "Seuls un formateur, un concepteur ou un administrateur peuvent animer une formation.",
    };
  }

  const { error } = await supabase.from("course_trainers").insert({
    course_id: courseId,
    user_id: cible,
    assigned_by: acces.userId,
  });

  if (error) {
    loguer("affectation", error);
    // 23505 = violation d'unicité : la personne est déjà affectée.
    if ((error as { code?: string }).code === "23505") {
      return { error: "Cette personne anime déjà cette formation." };
    }
    return { error: "L'affectation n'a pas pu être enregistrée. Réessayez." };
  }

  revalidatePath(`/catalogue/${courseId}/formateurs`);
  revalidatePath("/formations");
  return { success: "Formateur affecté à cette formation." };
}

export async function retirerFormateur(
  _prev: AuthState,
  formData: FormData
): Promise<AuthState> {
  const courseId = String(formData.get("course_id") ?? "");
  const cible = String(formData.get("user_id") ?? "");

  const acces = await verifierAcces(courseId);
  if (!acces.ok) return { error: acces.error };
  if (!cible) return { error: "Formateur introuvable." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("course_trainers")
    .delete()
    .eq("course_id", courseId)
    .eq("user_id", cible);

  if (error) {
    loguer("retrait", error);
    return { error: "Le retrait n'a pas pu être enregistré. Réessayez." };
  }

  /* Retirer l'affectation ne retire rien d'autre : les sessions déjà
     animées, les résultats et les certificats restent en place. Une
     affectation dit qui anime aujourd'hui, pas qui a animé hier. */
  revalidatePath(`/catalogue/${courseId}/formateurs`);
  revalidatePath("/formations");
  return { success: "Formateur retiré de cette formation." };
}

"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/profile";
import { genererCodeVerification } from "@/lib/certificats/certificats";
import type { ActionState } from "@/app/(app)/catalogue/actions";

function loguer(contexte: string, error: { message?: string; code?: string } | null) {
  if (error) console.error(`[certificats] ${contexte} :`, error.code ?? "", error.message ?? error);
}

const NIVEAUX_VALIDES = ["", "fundamentals", "operational", "advanced", "elite"];
const TYPES_DELIVRABLES = ["participation", "success", "skill"];

/**
 * Réclamation par l'apprenant de son attestation de complétion.
 * Double contrôle : vérification applicative ici + politique RLS en
 * base (inscription au statut « completed » exigée).
 */
export async function reclamerCompletion(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await getCurrentUser();
  if (!user) return { error: "Vous devez être connecté." };

  const courseId = String(formData.get("course_id") ?? "");
  const supabase = await createClient();

  const { data: inscription } = await supabase
    .from("enrollments")
    .select("id, status, completed_at, organization_id")
    .eq("course_id", courseId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!inscription || inscription.status !== "completed") {
    return {
      error:
        "L'attestation de complétion n'est disponible qu'une fois toutes les leçons terminées.",
    };
  }

  for (let essai = 0; essai < 5; essai++) {
    const { error } = await supabase.from("certificates").insert({
      user_id: user.id,
      organization_id: inscription.organization_id,
      course_id: courseId,
      certificate_type: "completion",
      verification_code: genererCodeVerification(),
      requirements_snapshot: {
        regle: "Complétion de 100 % des leçons de la formation",
        inscription_terminee_le: inscription.completed_at,
      },
      issued_by: user.id,
    });

    if (!error) {
      revalidatePath("/certificats");
      return { success: "Attestation de complétion générée. Retrouvez-la ci-dessous." };
    }
    if (error.code === "23505") {
      // Collision de code : nouvelle tentative. Mais si c'est le
      // doublon d'attestation, informer clairement.
      const { data: existante } = await supabase
        .from("certificates")
        .select("id")
        .eq("user_id", user.id)
        .eq("course_id", courseId)
        .eq("certificate_type", "completion")
        .maybeSingle();
      if (existante) {
        return { error: "Vous possédez déjà l'attestation de complétion de cette formation." };
      }
      continue;
    }
    loguer("réclamation", error);
    return { error: "La génération de l'attestation a échoué. Réessayez plus tard." };
  }
  return { error: "Impossible de générer un code unique. Réessayez." };
}

/**
 * Délivrance par l'encadrement (formateur/admin de l'organisation ou
 * Elite Experience) — la validation humaine reste ainsi obligatoire
 * pour les certificats de réussite et preuves de compétence.
 */
export async function delivrerCertificat(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await getCurrentUser();
  if (!user) return { error: "Vous devez être connecté." };

  const courseId = String(formData.get("course_id") ?? "");
  const beneficiaireId = String(formData.get("user_id") ?? "");
  const type = String(formData.get("certificate_type") ?? "");
  const niveau = String(formData.get("level") ?? "");
  const commentaire = String(formData.get("commentaire") ?? "").trim();

  if (!beneficiaireId) return { error: "Veuillez choisir l'apprenant." };
  if (!TYPES_DELIVRABLES.includes(type)) return { error: "Type de certificat invalide." };
  if (!NIVEAUX_VALIDES.includes(niveau)) return { error: "Niveau invalide." };

  const supabase = await createClient();

  // Vérification serveur du droit d'encadrement (RLS revérifie en base).
  const { data: encadre } = await supabase.rpc("oversees_course", { cid: courseId });
  if (!encadre) {
    return { error: "Vous n'avez pas le droit de délivrer un certificat pour cette formation." };
  }

  const { data: course } = await supabase
    .from("courses")
    .select("organization_id")
    .eq("id", courseId)
    .maybeSingle();
  if (!course) return { error: "Formation introuvable." };

  for (let essai = 0; essai < 5; essai++) {
    const { error } = await supabase.from("certificates").insert({
      user_id: beneficiaireId,
      organization_id: course.organization_id,
      course_id: courseId,
      certificate_type: type,
      level: niveau || null,
      verification_code: genererCodeVerification(),
      requirements_snapshot: {
        regle: "Délivrance validée par un responsable autorisé",
        commentaire: commentaire || null,
      },
      issued_by: user.id,
    });

    if (!error) {
      revalidatePath(`/catalogue/${courseId}/certificats`);
      return { success: "Certificat délivré." };
    }
    if (error.code === "23505") continue; // collision de code : retenter
    loguer("délivrance", error);
    return { error: "La délivrance a échoué. Vérifiez vos droits ou réessayez." };
  }
  return { error: "Impossible de générer un code unique. Réessayez." };
}

/** Révocation (le certificat reste tracé, jamais supprimé). */
export async function revoquerCertificat(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await getCurrentUser();
  if (!user) return { error: "Vous devez être connecté." };

  const certificatId = String(formData.get("certificate_id") ?? "");
  const courseId = String(formData.get("course_id") ?? "");
  const supabase = await createClient();

  const { error } = await supabase
    .from("certificates")
    .update({ status: "revoked", revoked_at: new Date().toISOString() })
    .eq("id", certificatId);

  if (error) {
    loguer("révocation", error);
    return { error: "La révocation a échoué. Vérifiez vos droits." };
  }
  revalidatePath(`/catalogue/${courseId}/certificats`);
  return { success: "Certificat révoqué. Il reste tracé mais apparaît comme non valide." };
}

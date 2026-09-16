"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/profile";
import { activeMemberships, isEliteAdmin } from "@/lib/auth/roles";
import { badgeParCle } from "@/lib/gamification/badges";
import { concretiserDistinction, proposerDistinction } from "@/lib/gamification/moteur";
import { emettreNotification } from "@/lib/notifications/emettre";
import type { ActionState } from "@/app/(app)/catalogue/actions";

/**
 * Distinctions (addendum Gamification §5) : proposition par un
 * encadrant, validation ou refus avec commentaire. Le changement de
 * statut passe par le client utilisateur (politique
 * `special_mentions_update`) ; les effets d'une validation (badge, XP,
 * notification) sont concrétisés par le moteur.
 */

function loguer(operation: string, erreur: unknown) {
  if (erreur) console.error(`[distinctions] ${operation}`, erreur);
}

/** Rôles qui peuvent proposer et valider dans une organisation. */
export async function organisationsEncadrees(): Promise<string[]> {
  const user = await getCurrentUser();
  if (!user) return [];
  if (isEliteAdmin(user.memberships)) return ["*"];
  return activeMemberships(user.memberships)
    .filter((m) => ["admin", "designer", "trainer", "manager"].includes(m.role))
    .map((m) => m.organization_id);
}

export async function proposerDistinctionManuelle(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await getCurrentUser();
  if (!user) return { error: "Vous devez être connecté." };

  const userId = String(formData.get("user_id") ?? "");
  const organizationId = String(formData.get("organization_id") ?? "");
  const badgeKey = String(formData.get("badge_key") ?? "");
  const courseId = String(formData.get("course_id") ?? "");
  const justification = String(formData.get("justification") ?? "").trim();

  const def = badgeParCle(badgeKey);
  if (!userId || !organizationId) return { error: "Choisissez un apprenant." };
  if (!def || !def.special) return { error: "Choisissez une distinction." };
  if (justification.length < 10) {
    return { error: "Expliquez en quelques mots pourquoi cette distinction est méritée (10 caractères minimum)." };
  }

  const encadrees = await organisationsEncadrees();
  if (!encadrees.includes("*") && !encadrees.includes(organizationId)) {
    return { error: "Vous n'encadrez pas cette organisation." };
  }

  const cree = await proposerDistinction({
    userId,
    organizationId,
    cle: badgeKey,
    criteres: { justification, source: "proposition_manuelle" },
    proposedBy: user.id,
    courseId: courseId || null,
  });
  if (!cree) {
    return { error: "Cette distinction est déjà proposée ou déjà obtenue pour cet apprenant." };
  }

  revalidatePath("/distinctions");
  return { success: `Distinction « ${def.nom} » proposée. Un autre encadrant ou vous-même pouvez la valider.` };
}

async function changerStatut(
  formData: FormData,
  statut: "validated" | "rejected"
): Promise<ActionState> {
  const user = await getCurrentUser();
  if (!user) return { error: "Vous devez être connecté." };

  const mentionId = String(formData.get("mention_id") ?? "");
  const commentaire = String(formData.get("comment") ?? "").trim();
  if (!mentionId) return { error: "Distinction introuvable." };
  if (statut === "rejected" && commentaire.length < 5) {
    return { error: "Indiquez à l'apprenant pourquoi la distinction est refusée." };
  }

  const supabase = await createClient();
  const { data: mention, error } = await supabase
    .from("special_mentions")
    .update(
      {
        status: statut,
        comment: commentaire || null,
        validated_by: user.id,
        validated_at: new Date().toISOString(),
      },
      { count: "exact" }
    )
    .eq("id", mentionId)
    .eq("status", "pending")
    .select("id, user_id, organization_id, course_id, badge:badges(badge_key, name)")
    .maybeSingle();

  if (error) {
    loguer(statut, error);
    return { error: "La décision n'a pas pu être enregistrée. Vérifiez vos droits." };
  }
  if (!mention) {
    return { error: "Cette distinction a déjà été traitée ou n'est pas visible." };
  }

  const badge = Array.isArray(mention.badge) ? mention.badge[0] : mention.badge;
  if (statut === "validated" && badge?.badge_key) {
    await concretiserDistinction({
      userId: mention.user_id as string,
      organizationId: mention.organization_id as string,
      badgeKey: badge.badge_key as string,
      mentionId,
      courseId: (mention.course_id as string) ?? null,
      commentaire,
    });
  } else {
    await emettreNotification({
      userId: mention.user_id as string,
      organizationId: mention.organization_id as string,
      type: "distinction_refusee",
      title: `Distinction « ${badge?.name ?? ""} » non attribuée`,
      body: commentaire,
      href: "/badges",
    });
  }

  revalidatePath("/distinctions");
  revalidatePath("/badges");
  return {
    success:
      statut === "validated"
        ? "Distinction validée : l'apprenant en est informé."
        : "Distinction refusée : l'apprenant reçoit votre commentaire.",
  };
}

export async function validerDistinction(_prev: ActionState, formData: FormData) {
  return changerStatut(formData, "validated");
}

export async function refuserDistinction(_prev: ActionState, formData: FormData) {
  return changerStatut(formData, "rejected");
}

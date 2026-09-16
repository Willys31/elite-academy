"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth/profile";
import { lirePreferences } from "@/lib/profil/preferences";
import { lirePortee, porteeExigeFormation } from "@/lib/partage/visibilite";
import {
  compteursCommunaute,
  entraideActive,
  franchitSeuil,
  peutVoter,
  validerBlocage,
  validerContribution,
  validerSignalement,
  xpPourVote,
} from "@/lib/entraide/entraide";
import { attribuerXp, fixerCompteurs, verifierBadges } from "@/lib/gamification/moteur";
import { emettreNotification, notifierEncadrementFormation } from "@/lib/notifications/emettre";
import type { ActionState } from "@/app/(app)/catalogue/actions";

/**
 * Actions de l'Entraide (addendum Entraide §3, §5).
 *
 * La RLS (migration 0014) fait foi : un apprenant ne publie que sur une
 * formation qu'il voit, ne s'aide pas lui-même, ne vote pas pour lui.
 * Les compteurs de votes et les points passent par le client
 * d'administration, jamais par le votant.
 */

function loguer(operation: string, erreur: unknown) {
  if (erreur) console.error(`[entraide] ${operation}`, erreur);
}

async function entraideActivee(supabase: Awaited<ReturnType<typeof createClient>>, userId: string) {
  const { data: profil } = await supabase
    .from("profiles")
    .select("preferences")
    .eq("id", userId)
    .maybeSingle();
  return entraideActive(lirePreferences(profil?.preferences));
}

// ------------------------------------------------------------
// Partager un point bloquant
// ------------------------------------------------------------

export async function partagerBlocage(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await getCurrentUser();
  if (!user) return { error: "Vous devez être connecté." };

  const courseId = String(formData.get("course_id") ?? "");
  const competencyId = String(formData.get("competency_id") ?? "");
  const activityId = String(formData.get("activity_id") ?? "");
  const portee = lirePortee(formData.get("portee"), "group");
  const description = validerBlocage(String(formData.get("description") ?? ""));

  if (!courseId) return { error: "Choisissez la formation concernée." };
  if (!description.ok) return { error: description.raison };
  if (porteeExigeFormation(portee) && !courseId) {
    return { error: "Le partage au groupe suppose une formation." };
  }

  const supabase = await createClient();
  if (!(await entraideActivee(supabase, user.id))) {
    return {
      error: "Activez d'abord l'Entraide dans votre profil : c'est un choix explicite, désactivé par défaut.",
    };
  }

  const { data: course } = await supabase
    .from("courses")
    .select("id, title, organization_id, organization:organizations(sector)")
    .eq("id", courseId)
    .maybeSingle();
  if (!course) return { error: "Formation introuvable ou non autorisée." };
  const org = Array.isArray(course.organization) ? course.organization[0] : course.organization;

  const { data: post, error } = await supabase
    .from("peer_help_posts")
    .insert({
      user_id: user.id,
      organization_id: course.organization_id,
      course_id: course.id,
      competency_id: competencyId || null,
      activity_id: activityId || null,
      visibility_scope: portee,
      sector: org?.sector ?? null,
      description: description.texte,
      status: "open",
    })
    .select("id")
    .single();

  if (error || !post) {
    loguer("publication", error);
    return { error: "Le blocage n'a pas pu être publié. Vérifiez que vous êtes inscrit à cette formation." };
  }

  await notifierEncadrementFormation(
    course.id,
    {
      type: "nouveau_blocage",
      title: `Nouveau point bloquant dans « ${course.title} »`,
      body: description.texte,
      href: `/entraide/${post.id}`,
    },
    user.id
  );

  revalidatePath("/entraide");
  redirect(`/entraide/${post.id}`);
}

// ------------------------------------------------------------
// Proposer une aide
// ------------------------------------------------------------

export async function proposerAide(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await getCurrentUser();
  if (!user) return { error: "Vous devez être connecté." };

  const postId = String(formData.get("post_id") ?? "");
  const texte = validerContribution(String(formData.get("contribution") ?? ""));
  if (!postId) return { error: "Blocage introuvable." };
  if (!texte.ok) return { error: texte.raison };

  const supabase = await createClient();
  if (!(await entraideActivee(supabase, user.id))) {
    return { error: "Activez l'Entraide dans votre profil pour proposer une aide." };
  }

  const { data: post } = await supabase
    .from("peer_help_posts")
    .select("id, user_id, organization_id, course_id, status, course:courses(title)")
    .eq("id", postId)
    .maybeSingle();
  if (!post) return { error: "Blocage introuvable ou non visible." };
  if (post.user_id === user.id) return { error: "Vous ne pouvez pas répondre à votre propre blocage." };
  if (post.status !== "open") return { error: "Ce blocage n'est plus ouvert aux contributions." };

  const { error } = await supabase.from("peer_help_contributions").insert({
    post_id: post.id,
    user_id: user.id,
    organization_id: post.organization_id,
    contribution_text: texte.texte,
  });
  if (error) {
    if (error.code === "23505") return { error: "Vous avez déjà proposé une aide sur ce blocage." };
    loguer("contribution", error);
    return { error: "Votre aide n'a pas pu être publiée. Réessayez." };
  }

  const course = Array.isArray(post.course) ? post.course[0] : post.course;
  await emettreNotification({
    userId: post.user_id as string,
    organizationId: post.organization_id as string,
    type: "aide_recue",
    title: `Quelqu'un a proposé une aide à votre blocage${course?.title ? ` sur « ${course.title} »` : ""}`,
    body: texte.texte,
    href: `/entraide/${post.id}`,
  });

  revalidatePath(`/entraide/${post.id}`);
  revalidatePath("/entraide");
  return { success: "Votre aide est publiée. Merci pour ce coup de main." };
}

// ------------------------------------------------------------
// Voter « Utile »
// ------------------------------------------------------------

export async function voterUtile(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await getCurrentUser();
  if (!user) return { error: "Vous devez être connecté." };

  const contributionId = String(formData.get("contribution_id") ?? "");
  if (!contributionId) return { error: "Contribution introuvable." };

  const supabase = await createClient();
  const { data: contribution } = await supabase
    .from("peer_help_contributions")
    .select("id, user_id, organization_id, post_id, useful_votes_count, post:peer_help_posts(course_id)")
    .eq("id", contributionId)
    .maybeSingle();
  if (!contribution) return { error: "Contribution introuvable ou non visible." };
  if (!peutVoter({ votantId: user.id, auteurContributionId: contribution.user_id })) {
    return { error: "On ne vote pas pour sa propre aide." };
  }

  const { data: vote, error } = await supabase
    .from("peer_help_votes")
    .insert({ contribution_id: contribution.id, user_id: user.id })
    .select("id")
    .single();
  if (error || !vote) {
    if (error?.code === "23505") return { error: "Vous avez déjà voté pour cette aide." };
    loguer("vote", error);
    return { error: "Le vote n'a pas pu être enregistré." };
  }

  // Effets côté plateforme : compteur, XP du contributeur, badges, seuils.
  try {
    const admin = createAdminClient();
    const avant = Number(contribution.useful_votes_count);
    const apres = avant + 1;
    await admin
      .from("peer_help_contributions")
      .update({ useful_votes_count: apres })
      .eq("id", contribution.id);

    const contributeur = contribution.user_id as string;
    const post = Array.isArray(contribution.post) ? contribution.post[0] : contribution.post;
    const debutJour = new Date();
    debutJour.setUTCHours(0, 0, 0, 0);
    const { count: dejaAujourdhui } = await admin
      .from("xp_events")
      .select("id", { count: "exact", head: true })
      .eq("user_id", contributeur)
      .eq("xp_type", "entraide_utile")
      .gte("created_at", debutJour.toISOString());

    const montant = xpPourVote(dejaAujourdhui ?? 0);
    if (montant > 0) {
      await attribuerXp({
        userId: contributeur,
        organizationId: contribution.organization_id as string,
        type: "entraide_utile",
        montant,
        referenceId: vote.id as string,
        courseId: (post?.course_id as string) ?? null,
        details: { contribution_id: contribution.id },
      });
    }

    const { data: toutes } = await admin
      .from("peer_help_contributions")
      .select("useful_votes_count")
      .eq("user_id", contributeur);
    const { data: situations } = await admin
      .from("work_situations")
      .select("useful_votes_count")
      .eq("user_id", contributeur);
    const compteurs = compteursCommunaute({
      contributions: (toutes ?? []).map((c) => ({ votes: Number(c.useful_votes_count) })),
      votesSituations: (situations ?? []).reduce((s, w) => s + Number(w.useful_votes_count ?? 0), 0),
    });
    await fixerCompteurs(contributeur, compteurs);
    await verifierBadges(contributeur, contribution.organization_id as string);

    const seuil = franchitSeuil(avant, apres);
    if (seuil) {
      await emettreNotification({
        userId: contributeur,
        organizationId: contribution.organization_id as string,
        type: "votes_utiles",
        title: `Votre aide a été votée « Utile » par ${apres} apprenant${apres > 1 ? "s" : ""}`,
        body: montant > 0 ? `+${montant} XP` : null,
        href: `/entraide/${contribution.post_id}`,
      });
    }
  } catch (erreur) {
    // `work_situations` n'existe pas avant le lot 16 : le vote reste acquis.
    loguer("effets du vote", erreur);
  }

  revalidatePath(`/entraide/${contribution.post_id}`);
  return { success: "Merci, votre vote est pris en compte." };
}

// ------------------------------------------------------------
// Résoudre son blocage
// ------------------------------------------------------------

export async function marquerResolu(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await getCurrentUser();
  if (!user) return { error: "Vous devez être connecté." };

  const postId = String(formData.get("post_id") ?? "");
  const supabase = await createClient();
  const { error, count } = await supabase
    .from("peer_help_posts")
    .update({ status: "resolved", resolved_at: new Date().toISOString() }, { count: "exact" })
    .eq("id", postId)
    .eq("user_id", user.id)
    .eq("status", "open");

  if (error) {
    loguer("résolution", error);
    return { error: "Le blocage n'a pas pu être marqué comme résolu." };
  }
  if (count === 0) return { error: "Ce blocage n'est pas le vôtre ou n'est plus ouvert." };

  revalidatePath(`/entraide/${postId}`);
  revalidatePath("/entraide");
  return { success: "Blocage marqué comme résolu. Bravo, et merci à ceux qui vous ont aidé." };
}

// ------------------------------------------------------------
// Signaler une contribution
// ------------------------------------------------------------

export async function signalerContribution(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await getCurrentUser();
  if (!user) return { error: "Vous devez être connecté." };

  const contributionId = String(formData.get("contribution_id") ?? "");
  const motif = validerSignalement(String(formData.get("reason") ?? ""));
  if (!contributionId) return { error: "Contribution introuvable." };
  if (!motif.ok) return { error: motif.raison };

  const supabase = await createClient();
  const { data: contribution } = await supabase
    .from("peer_help_contributions")
    .select("id, post_id, post:peer_help_posts(course_id)")
    .eq("id", contributionId)
    .maybeSingle();
  if (!contribution) return { error: "Contribution introuvable." };

  const { error } = await supabase.from("peer_help_reports").insert({
    contribution_id: contribution.id,
    user_id: user.id,
    reason: motif.texte,
  });
  if (error) {
    if (error.code === "23505") return { error: "Vous avez déjà signalé cette contribution." };
    loguer("signalement", error);
    return { error: "Le signalement n'a pas pu être envoyé (on ne signale pas sa propre aide)." };
  }

  const post = Array.isArray(contribution.post) ? contribution.post[0] : contribution.post;
  if (post?.course_id) {
    await notifierEncadrementFormation(post.course_id as string, {
      type: "contribution_signalee",
      title: "Une contribution a été signalée",
      body: motif.texte,
      href: "/entraide/moderation",
    });
  }

  revalidatePath(`/entraide/${contribution.post_id}`);
  return { success: "Signalement transmis à l'encadrement. Merci." };
}

// ------------------------------------------------------------
// Modération (encadrement de la formation)
// ------------------------------------------------------------

async function masquer(
  table: "peer_help_contributions" | "peer_help_posts",
  formData: FormData,
  masque: boolean
): Promise<ActionState> {
  const user = await getCurrentUser();
  if (!user) return { error: "Vous devez être connecté." };

  const id = String(formData.get("id") ?? "");
  const motif = String(formData.get("reason") ?? "").trim();
  if (!id) return { error: "Élément introuvable." };
  if (masque && motif.length < 3) return { error: "Indiquez le motif du masquage : il est transmis à l'auteur." };

  const supabase = await createClient();
  const { data: ligne, error } = await supabase
    .from(table)
    .update(
      {
        is_hidden: masque,
        hidden_by: masque ? user.id : null,
        hidden_reason: masque ? motif : null,
      },
      { count: "exact" }
    )
    .eq("id", id)
    .select("id, user_id, organization_id")
    .maybeSingle();

  if (error) {
    loguer("masquage", error);
    return { error: "L'opération a échoué. Vérifiez vos droits." };
  }
  if (!ligne) return { error: "Élément introuvable ou droits insuffisants." };

  if (masque) {
    await emettreNotification({
      userId: ligne.user_id as string,
      organizationId: ligne.organization_id as string,
      type: "contribution_masquee",
      title:
        table === "peer_help_contributions"
          ? "Votre contribution a été masquée"
          : "Votre point bloquant a été masqué",
      body: `Motif : ${motif}. Relisez les règles de l'Entraide avant une prochaine publication.`,
      href: "/entraide",
    });
  }

  revalidatePath("/entraide");
  revalidatePath("/entraide/moderation");
  return { success: masque ? "Contenu masqué, l'auteur est prévenu." : "Contenu de nouveau visible." };
}

export async function masquerContribution(_prev: ActionState, fd: FormData) {
  return masquer("peer_help_contributions", fd, true);
}
export async function demasquerContribution(_prev: ActionState, fd: FormData) {
  return masquer("peer_help_contributions", fd, false);
}
export async function masquerBlocage(_prev: ActionState, fd: FormData) {
  return masquer("peer_help_posts", fd, true);
}
export async function demasquerBlocage(_prev: ActionState, fd: FormData) {
  return masquer("peer_help_posts", fd, false);
}

export async function traiterSignalement(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await getCurrentUser();
  if (!user) return { error: "Vous devez être connecté." };

  const reportId = String(formData.get("report_id") ?? "");
  const decision = String(formData.get("decision") ?? "");
  if (!reportId || !["reviewed", "dismissed"].includes(decision)) {
    return { error: "Décision invalide." };
  }

  const supabase = await createClient();
  const { error, count } = await supabase
    .from("peer_help_reports")
    .update(
      { status: decision, reviewed_by: user.id, reviewed_at: new Date().toISOString() },
      { count: "exact" }
    )
    .eq("id", reportId)
    .eq("status", "pending");

  if (error) {
    loguer("signalement traité", error);
    return { error: "Le signalement n'a pas pu être traité." };
  }
  if (count === 0) return { error: "Signalement déjà traité ou droits insuffisants." };

  revalidatePath("/entraide/moderation");
  return { success: decision === "reviewed" ? "Signalement traité." : "Signalement classé sans suite." };
}

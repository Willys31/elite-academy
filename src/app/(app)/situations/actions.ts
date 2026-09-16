"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth/profile";
import { lirePortee, porteeExigeFormation } from "@/lib/partage/visibilite";
import {
  compteursSituations,
  normaliserTags,
  secteursExperts,
  secteurValide,
  validerSituation as validerChamps,
} from "@/lib/situations/situations";
import { compteursCommunaute, franchitSeuil } from "@/lib/entraide/entraide";
import { XP_FIXES } from "@/lib/gamification/xp";
import {
  attribuerXp,
  decernerBadge,
  fixerCompteurs,
  verifierBadges,
} from "@/lib/gamification/moteur";
import { emettreNotification, notifierEncadrementFormation } from "@/lib/notifications/emettre";
import type { ActionState } from "@/app/(app)/catalogue/actions";

/**
 * Actions des situations de travail (addendum §5 workflow, §5.4 votes).
 * La RLS (migration 0015) fait foi : un auteur ne valide jamais sa
 * propre situation, un vote ne va jamais à soi-même. Points, compteurs
 * et badges passent par le moteur (client d'administration).
 */

function loguer(operation: string, erreur: unknown) {
  if (erreur) console.error(`[situations] ${operation}`, erreur);
}

function lireChamps(formData: FormData) {
  return {
    title: String(formData.get("title") ?? ""),
    context: String(formData.get("context") ?? ""),
    situation: String(formData.get("situation") ?? ""),
    resolution: String(formData.get("resolution") ?? ""),
    result: String(formData.get("result") ?? ""),
  };
}

function lireCompetences(formData: FormData): string[] {
  return [...new Set(formData.getAll("competency_ids").map(String).filter(Boolean))];
}

// ------------------------------------------------------------
// Soumission et correction par l'apprenant
// ------------------------------------------------------------

export async function soumettreSituation(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await getCurrentUser();
  if (!user) return { error: "Vous devez être connecté." };

  const courseId = String(formData.get("course_id") ?? "");
  const competences = lireCompetences(formData);
  const portee = lirePortee(formData.get("portee"));
  const secteur = String(formData.get("sector") ?? "");
  const anonymise = formData.get("is_anonymized") === "on";
  const tags = normaliserTags(String(formData.get("tags") ?? ""));

  if (!courseId) return { error: "Choisissez la formation concernée." };
  if (!secteurValide(secteur)) return { error: "Choisissez un secteur." };
  const validation = validerChamps(lireChamps(formData), competences.length);
  if (!validation.ok) return { error: validation.erreurs.join(" ") };
  if (porteeExigeFormation(portee) && !courseId) return { error: "Le partage au groupe suppose une formation." };

  const supabase = await createClient();
  const { data: course } = await supabase
    .from("courses")
    .select("id, title, organization_id")
    .eq("id", courseId)
    .maybeSingle();
  if (!course) return { error: "Formation introuvable ou non autorisée." };

  const { data: situation, error } = await supabase
    .from("work_situations")
    .insert({
      user_id: user.id,
      organization_id: course.organization_id,
      course_id: course.id,
      visibility_scope: portee,
      sector: secteur,
      ...validation.champs,
      is_anonymized: anonymise,
      status: "submitted",
    })
    .select("id")
    .single();
  if (error || !situation) {
    loguer("soumission", error);
    return { error: "La situation n'a pas pu être enregistrée. Vérifiez que vous êtes inscrit à cette formation." };
  }

  const [{ error: erreurComp }, { error: erreurTags }] = await Promise.all([
    supabase
      .from("situation_competencies")
      .insert(competences.map((competency_id) => ({ situation_id: situation.id, competency_id }))),
    tags.length > 0
      ? supabase.from("situation_tags").insert(tags.map((tag) => ({ situation_id: situation.id, tag })))
      : Promise.resolve({ error: null }),
  ]);
  loguer("compétences", erreurComp);
  loguer("tags", erreurTags);

  await notifierEncadrementFormation(
    course.id,
    {
      type: "situation_a_valider",
      title: `Nouvelle situation de travail à valider : « ${validation.champs.title} »`,
      body: `Formation « ${course.title} ». Vérifiez la qualité, la confidentialité et le niveau de partage.`,
      href: `/situations/${situation.id}`,
    },
    user.id
  );

  revalidatePath("/situations");
  redirect(`/situations/${situation.id}`);
}

export async function modifierSituation(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await getCurrentUser();
  if (!user) return { error: "Vous devez être connecté." };

  const id = String(formData.get("situation_id") ?? "");
  const competences = lireCompetences(formData);
  const portee = lirePortee(formData.get("portee"));
  const secteur = String(formData.get("sector") ?? "");
  const anonymise = formData.get("is_anonymized") === "on";
  const tags = normaliserTags(String(formData.get("tags") ?? ""));
  if (!id) return { error: "Situation introuvable." };
  if (!secteurValide(secteur)) return { error: "Choisissez un secteur." };
  const validation = validerChamps(lireChamps(formData), competences.length);
  if (!validation.ok) return { error: validation.erreurs.join(" ") };

  const supabase = await createClient();
  const { error, count } = await supabase
    .from("work_situations")
    .update(
      { ...validation.champs, visibility_scope: portee, sector: secteur, is_anonymized: anonymise },
      { count: "exact" }
    )
    .eq("id", id)
    .eq("user_id", user.id)
    .eq("status", "submitted");
  if (error) {
    loguer("modification", error);
    return { error: "La modification a échoué." };
  }
  if (count === 0) return { error: "Cette situation n'est plus modifiable (déjà traitée) ou n'est pas la vôtre." };

  await supabase.from("situation_competencies").delete().eq("situation_id", id);
  await supabase
    .from("situation_competencies")
    .insert(competences.map((competency_id) => ({ situation_id: id, competency_id })));
  await supabase.from("situation_tags").delete().eq("situation_id", id);
  if (tags.length > 0) {
    await supabase.from("situation_tags").insert(tags.map((tag) => ({ situation_id: id, tag })));
  }

  revalidatePath(`/situations/${id}`);
  return { success: "Situation mise à jour. Elle reste en attente de validation." };
}

export async function supprimerSituation(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await getCurrentUser();
  if (!user) return { error: "Vous devez être connecté." };
  const id = String(formData.get("situation_id") ?? "");
  const supabase = await createClient();
  const { error, count } = await supabase
    .from("work_situations")
    .delete({ count: "exact" })
    .eq("id", id)
    .eq("user_id", user.id)
    .neq("status", "validated");
  if (error) {
    loguer("suppression", error);
    return { error: "La suppression a échoué." };
  }
  if (count === 0) return { error: "Une situation publiée ne se retire pas : elle fait partie de la base de connaissances." };
  revalidatePath("/situations");
  redirect("/situations?retiree=1");
}

// ------------------------------------------------------------
// Validation par l'encadrement
// ------------------------------------------------------------

async function decider(
  formData: FormData,
  statut: "validated" | "rejected"
): Promise<ActionState> {
  const user = await getCurrentUser();
  if (!user) return { error: "Vous devez être connecté." };

  const id = String(formData.get("situation_id") ?? "");
  const motif = String(formData.get("rejection_reason") ?? "").trim();
  const complexe = formData.get("is_complex_problem") === "on";
  if (!id) return { error: "Situation introuvable." };
  if (statut === "rejected" && motif.length < 5) {
    return { error: "Indiquez à l'apprenant pourquoi sa situation est refusée." };
  }

  const supabase = await createClient();
  const { data: situation, error } = await supabase
    .from("work_situations")
    .update(
      {
        status: statut,
        validated_by: user.id,
        validated_at: new Date().toISOString(),
        rejection_reason: statut === "rejected" ? motif : null,
        is_complex_problem: statut === "validated" ? complexe : false,
      },
      { count: "exact" }
    )
    .eq("id", id)
    .eq("status", "submitted")
    .neq("user_id", user.id)
    .select("id, user_id, organization_id, course_id, title, sector")
    .maybeSingle();

  if (error) {
    loguer(statut, error);
    return { error: "La décision n'a pas pu être enregistrée. Vérifiez vos droits." };
  }
  if (!situation) return { error: "Situation déjà traitée, introuvable, ou c'est la vôtre." };

  const auteur = situation.user_id as string;
  const organizationId = situation.organization_id as string;

  if (statut === "validated") {
    await attribuerXp({
      userId: auteur,
      organizationId,
      type: "situation_validee",
      montant: XP_FIXES.situation_validee,
      referenceId: id,
      courseId: situation.course_id as string,
    });
    await recalculerCompteursSituations(auteur, organizationId);
    await emettreNotification({
      userId: auteur,
      organizationId,
      type: "situation_validee",
      title: `Votre situation « ${situation.title} » est publiée`,
      body: `+${XP_FIXES.situation_validee} XP. Merci pour ce partage d'expérience.`,
      href: `/situations/${id}`,
    });
  } else {
    await emettreNotification({
      userId: auteur,
      organizationId,
      type: "situation_refusee",
      title: `Votre situation « ${situation.title} » n'a pas été retenue`,
      body: motif,
      href: `/situations/${id}`,
    });
  }

  revalidatePath("/situations");
  revalidatePath(`/situations/${id}`);
  return { success: statut === "validated" ? "Situation validée et publiée." : "Situation refusée, l'auteur reçoit votre motif." };
}

export async function validerSituation(_prev: ActionState, fd: FormData) {
  return decider(fd, "validated");
}
export async function refuserSituation(_prev: ActionState, fd: FormData) {
  return decider(fd, "rejected");
}

/** Compteurs Storyteller / Problem Solver / Expert de secteur, puis badges. */
async function recalculerCompteursSituations(userId: string, organizationId: string) {
  try {
    const admin = createAdminClient();
    const { data } = await admin
      .from("work_situations")
      .select("useful_votes_count, sector, is_complex_problem")
      .eq("user_id", userId)
      .eq("status", "validated");
    const compteurs = compteursSituations(
      (data ?? []).map((s) => ({
        votes: Number(s.useful_votes_count),
        sector: s.sector as string,
        isComplexProblem: Boolean(s.is_complex_problem),
      }))
    );
    await fixerCompteurs(userId, {
      situations_validees: compteurs.situations_validees,
      situations_storyteller: compteurs.situations_storyteller,
      problem_solver: compteurs.problem_solver,
    });
    await verifierBadges(userId, organizationId);
    for (const secteur of secteursExperts(compteurs.situations_secteur)) {
      await decernerBadge(userId, organizationId, "expert_secteur", secteur, { secteur });
    }
  } catch (erreur) {
    loguer("compteurs", erreur);
  }
}

export async function mettreEnAvant(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await getCurrentUser();
  if (!user) return { error: "Vous devez être connecté." };
  const id = String(formData.get("situation_id") ?? "");
  const retirer = formData.get("retirer") === "1";
  const supabase = await createClient();
  const { error, count } = await supabase
    .from("work_situations")
    .update({ featured_at: retirer ? null : new Date().toISOString() }, { count: "exact" })
    .eq("id", id)
    .eq("status", "validated");
  if (error) {
    loguer("mise en avant", error);
    return { error: "L'opération a échoué. Vérifiez vos droits." };
  }
  if (count === 0) return { error: "Seule une situation publiée peut être mise en avant." };
  revalidatePath("/situations");
  revalidatePath(`/situations/${id}`);
  return { success: retirer ? "Mise en avant retirée." : "Situation mise en avant." };
}

// ------------------------------------------------------------
// Votes « Utile »
// ------------------------------------------------------------

export async function voterSituationUtile(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await getCurrentUser();
  if (!user) return { error: "Vous devez être connecté." };

  const id = String(formData.get("situation_id") ?? "");
  const supabase = await createClient();
  const { data: situation } = await supabase
    .from("work_situations")
    .select("id, user_id, organization_id, useful_votes_count, status")
    .eq("id", id)
    .maybeSingle();
  if (!situation) return { error: "Situation introuvable." };
  if (situation.user_id === user.id) return { error: "On ne vote pas pour sa propre situation." };
  if (situation.status !== "validated") return { error: "Cette situation n'est pas encore publiée." };

  const { error } = await supabase.from("situation_votes").insert({ situation_id: id, user_id: user.id });
  if (error) {
    if (error.code === "23505") return { error: "Vous avez déjà voté pour cette situation." };
    loguer("vote", error);
    return { error: "Le vote n'a pas pu être enregistré." };
  }

  try {
    const admin = createAdminClient();
    const avant = Number(situation.useful_votes_count);
    const apres = avant + 1;
    await admin.from("work_situations").update({ useful_votes_count: apres }).eq("id", id);

    const auteur = situation.user_id as string;
    const organizationId = situation.organization_id as string;
    const [{ data: contributions }, { data: situations }] = await Promise.all([
      admin.from("peer_help_contributions").select("useful_votes_count").eq("user_id", auteur),
      admin.from("work_situations").select("useful_votes_count").eq("user_id", auteur),
    ]);
    await fixerCompteurs(
      auteur,
      compteursCommunaute({
        contributions: (contributions ?? []).map((c) => ({ votes: Number(c.useful_votes_count) })),
        votesSituations: (situations ?? []).reduce((s, w) => s + Number(w.useful_votes_count ?? 0), 0),
      })
    );
    await recalculerCompteursSituations(auteur, organizationId);

    const seuil = franchitSeuil(avant, apres);
    if (seuil) {
      await emettreNotification({
        userId: auteur,
        organizationId,
        type: "votes_utiles",
        title: `Votre situation de travail a reçu ${apres} vote${apres > 1 ? "s" : ""} « Utile »`,
        href: `/situations/${id}`,
      });
    }
  } catch (erreur) {
    loguer("effets du vote", erreur);
  }

  revalidatePath(`/situations/${id}`);
  revalidatePath("/situations");
  return { success: "Merci, votre vote est pris en compte." };
}

// ------------------------------------------------------------
// Lien avec un de mes blocages (lot 15)
// ------------------------------------------------------------

export async function lierABlocage(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await getCurrentUser();
  if (!user) return { error: "Vous devez être connecté." };
  const situationId = String(formData.get("situation_id") ?? "");
  const postId = String(formData.get("post_id") ?? "");
  if (!situationId || !postId) return { error: "Choisissez un de vos blocages." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("situation_blocking_links")
    .insert({ situation_id: situationId, post_id: postId, linked_by: user.id });
  if (error) {
    if (error.code === "23505") return { error: "Ce lien existe déjà." };
    loguer("lien blocage", error);
    return { error: "Le lien n'a pas pu être créé (le blocage doit être le vôtre)." };
  }
  revalidatePath(`/situations/${situationId}`);
  revalidatePath(`/entraide/${postId}`);
  return { success: "Cette situation illustre maintenant votre blocage." };
}

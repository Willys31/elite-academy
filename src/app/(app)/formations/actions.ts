"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { precorrigerTentative } from "@/lib/courses/precorrection";
import { getCurrentUser } from "@/lib/auth/profile";
import { calculerCompletion, corrigerQcm, tentativeEnAttente } from "@/lib/courses/progression";
import {
  lireQuestion,
  lireReponse,
  type QuestionCorrigeable,
  type ReponseDonnee,
} from "@/lib/courses/questions";
import { donneAcces, peutSeDesinscrire } from "@/lib/courses/inscriptions";
import { estTestDePositionnement } from "@/lib/courses/positionnement";
import { mettreAJourMaitrise } from "@/lib/courses/maitrise";
import { XP_FIXES } from "@/lib/gamification/xp";
import { attribuerXp, mettreAJourSerie, verifierBadges } from "@/lib/gamification/moteur";
import { gamifierTentative, tentativesPrecedentes } from "@/lib/gamification/tentative";
import { notifierEncadrementFormation } from "@/lib/notifications/emettre";
import type { ActionState } from "@/app/(app)/catalogue/actions";

function loguer(contexte: string, error: { message?: string } | null) {
  if (error) console.error(`[formations] ${contexte} :`, error.message ?? error);
}

// ------------------------------------------------------------
// Inscription à une formation publiée
// ------------------------------------------------------------

export async function sInscrireFormation(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await getCurrentUser();
  if (!user) return { error: "Vous devez être connecté." };

  const courseId = String(formData.get("course_id") ?? "");
  const supabase = await createClient();

  const { data: course } = await supabase
    .from("courses")
    .select("id, organization_id, status")
    .eq("id", courseId)
    .maybeSingle();

  if (!course) return { error: "Formation introuvable ou non autorisée." };
  if (course.status !== "published") {
    return { error: "Cette formation n'est pas encore publiée." };
  }

  // `unique (course_id, user_id)` interdit une seconde inscription : un
  // apprenant qui revient réactive donc sa ligne retirée, et retrouve
  // du même coup la progression qui y était restée attachée.
  const { data: existante } = await supabase
    .from("enrollments")
    .select("id, status")
    .eq("course_id", course.id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (existante) {
    if (existante.status === "suspended") {
      return {
        error:
          "Votre inscription à cette formation a été suspendue par l'encadrement. Contactez votre responsable pour la réactiver.",
      };
    }
    if (existante.status !== "withdrawn") {
      return { error: "Vous êtes déjà inscrit à cette formation." };
    }

    // `started_at` d'origine conservé : c'est une reprise, pas un
    // nouveau départ.
    const { error, count } = await supabase
      .from("enrollments")
      .update({ status: "active" }, { count: "exact" })
      .eq("id", existante.id)
      .eq("user_id", user.id)
      .eq("status", "withdrawn");
    if (error) {
      loguer("réinscription", error);
      return { error: "La réinscription a échoué. Réessayez plus tard." };
    }
    if (count === 0) {
      return {
        error:
          "La réinscription n'a pas pu être enregistrée : votre inscription a peut-être changé entre-temps. Rechargez la page.",
      };
    }
  } else {
    const { error } = await supabase.from("enrollments").insert({
      course_id: course.id,
      user_id: user.id,
      organization_id: course.organization_id,
      status: "active",
      started_at: new Date().toISOString(),
    });

    if (error) {
      // Deux envois simultanés : le second heurte la contrainte d'unicité.
      if (error.code === "23505") {
        return { error: "Vous êtes déjà inscrit à cette formation." };
      }
      loguer("inscription", error);
      return { error: "L'inscription a échoué. Réessayez plus tard." };
    }
  }

  revalidatePath(`/catalogue/${course.id}`);
  revalidatePath("/formations");
  redirect(`/formations/${course.id}`);
}

// ------------------------------------------------------------
// Désinscription d'une formation en cours
// ------------------------------------------------------------

/**
 * Retire l'apprenant d'une formation en cours.
 *
 * L'inscription passe au statut `withdrawn`, elle n'est pas supprimée :
 * les leçons terminées (`progress_records`) et les tentatives de QCM
 * (`attempts`, non supprimables par conception) restent en place, si
 * bien qu'une réinscription reprend là où l'apprenant s'était arrêté.
 * Aucune migration n'est nécessaire : la politique `enrollments_update`
 * autorise déjà l'apprenant à modifier sa propre inscription.
 *
 * Les règles (formations en cours uniquement, pas de retrait d'un
 * parcours attribué) vivent dans `peutSeDesinscrire`.
 */
export async function seDesinscrireFormation(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await getCurrentUser();
  if (!user) return { error: "Vous devez être connecté." };

  const courseId = String(formData.get("course_id") ?? "");
  const supabase = await createClient();

  const { data: inscription } = await supabase
    .from("enrollments")
    .select("id, status, assigned_by")
    .eq("course_id", courseId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!inscription) return { error: "Vous n'êtes pas inscrit à cette formation." };

  const verdict = peutSeDesinscrire({
    statut: inscription.status,
    assigneePar: inscription.assigned_by,
  });
  if (!verdict.ok) return { error: verdict.raison };

  // Filtre sur `status = active` : si l'inscription a changé entre la
  // lecture et l'écriture (leçon terminée dans un autre onglet), rien
  // n'est modifié plutôt que d'écraser un statut `completed`.
  const { error, count } = await supabase
    .from("enrollments")
    .update({ status: "withdrawn" }, { count: "exact" })
    .eq("id", inscription.id)
    .eq("user_id", user.id)
    .eq("status", "active");

  if (error) {
    loguer("désinscription", error);
    return { error: "La désinscription a échoué. Réessayez plus tard." };
  }
  // RLS ne renvoie pas d'erreur quand aucune ligne n'est visible : sans
  // ce contrôle, un refus passerait pour un succès.
  if (count === 0) {
    return {
      error:
        "La désinscription n'a pas pu être enregistrée : votre inscription a peut-être changé entre-temps. Rechargez la page.",
    };
  }

  revalidatePath("/formations");
  revalidatePath(`/formations/${courseId}`);
  revalidatePath(`/catalogue/${courseId}`);
  redirect("/formations?desinscrit=1");
}

// ------------------------------------------------------------
// Marquer une leçon comme terminée
// ------------------------------------------------------------

/** Identifiants des leçons de la version courante d'une formation. */
async function leconsDeLaFormation(
  supabase: Awaited<ReturnType<typeof createClient>>,
  courseId: string
): Promise<string[]> {
  const { data: course } = await supabase
    .from("courses")
    .select("current_version_id")
    .eq("id", courseId)
    .maybeSingle();
  if (!course?.current_version_id) return [];

  const { data: modules } = await supabase
    .from("modules")
    .select("id")
    .eq("course_version_id", course.current_version_id);
  const moduleIds = (modules ?? []).map((m) => m.id);
  if (moduleIds.length === 0) return [];

  const { data: lessons } = await supabase
    .from("lessons")
    .select("id")
    .in("module_id", moduleIds);
  return (lessons ?? []).map((l) => l.id);
}

export async function marquerLeconTerminee(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await getCurrentUser();
  if (!user) return { error: "Vous devez être connecté." };

  const courseId = String(formData.get("course_id") ?? "");
  const lessonId = String(formData.get("lesson_id") ?? "");
  const supabase = await createClient();

  /* Les preuves (leçon terminée, inscription terminée) s'écrivent avec le
     client d'administration depuis la migration 0019 : l'apprenant n'a
     plus de droit d'écriture direct. Les droits se vérifient donc ICI,
     avec le client de l'utilisateur (RLS) : inscription donnant accès,
     et leçon appartenant bien à la version courante de la formation. */
  const { data: inscription } = await supabase
    .from("enrollments")
    .select("organization_id, status")
    .eq("course_id", courseId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!inscription || !donneAcces(inscription.status)) {
    return { error: "Vous n'êtes pas inscrit à cette formation." };
  }
  const toutes = await leconsDeLaFormation(supabase, courseId);
  if (!toutes.includes(lessonId)) {
    return { error: "Cette leçon n'appartient pas à la formation." };
  }
  const admin = createAdminClient();

  // Enregistrer (ou confirmer) la leçon terminée.
  const { data: existant } = await supabase
    .from("progress_records")
    .select("id")
    .eq("user_id", user.id)
    .eq("lesson_id", lessonId)
    .maybeSingle();

  let xpGagne = 0;
  if (!existant) {
    const { error } = await admin.from("progress_records").insert({
      user_id: user.id,
      course_id: courseId,
      lesson_id: lessonId,
      completion_percent: 100,
    });
    if (error) {
      loguer("leçon terminée", error);
      return { error: "L'enregistrement a échoué. Réessayez." };
    }

    // Gamification : la première fois seulement (référence = leçon).
    xpGagne = await attribuerXp({
      userId: user.id,
      organizationId: inscription.organization_id,
      type: "lecon_terminee",
      montant: XP_FIXES.lecon_terminee,
      referenceId: lessonId,
      courseId,
    });
    await mettreAJourSerie(user.id, inscription.organization_id);
    await verifierBadges(user.id, inscription.organization_id);
  }

  // Mettre à jour la complétion de l'inscription.
  const { data: faites } = await supabase
    .from("progress_records")
    .select("lesson_id")
    .eq("user_id", user.id)
    .eq("course_id", courseId)
    .not("lesson_id", "is", null);

  const completion = calculerCompletion(
    (faites ?? []).filter((f) => toutes.includes(f.lesson_id as string)).length,
    toutes.length
  );
  if (completion === 100) {
    await admin
      .from("enrollments")
      .update({ status: "completed", completed_at: new Date().toISOString() })
      .eq("course_id", courseId)
      .eq("user_id", user.id)
      .eq("status", "active");
  }

  revalidatePath(`/formations/${courseId}`);
  return {
    success: xpGagne > 0 ? `Leçon marquée comme terminée. +${xpGagne} XP` : "Leçon marquée comme terminée.",
  };
}

// ------------------------------------------------------------
// Soumission d'une activité : correction serveur, tentative, progression
// ------------------------------------------------------------

export async function soumettreQcm(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await getCurrentUser();
  if (!user) return { error: "Vous devez être connecté." };

  const courseId = String(formData.get("course_id") ?? "");
  const activityId = String(formData.get("activity_id") ?? "");
  const sessionId = String(formData.get("session_id") ?? "");
  /* Horodatage de l'affichage, posé par le serveur dans un champ caché.
     Il sert uniquement au bonus de rapidité : une valeur absente ou
     manipulée ne fait perdre que ce bonus, jamais la correction. */
  const affichageMs = parseInt(String(formData.get("started_at") ?? ""), 10);
  const dureeSecondes =
    Number.isFinite(affichageMs) && affichageMs > 0
      ? Math.round((Date.now() - affichageMs) / 1000)
      : null;
  const supabase = await createClient();

  /* L'activité doit être visible de l'appelant (politique
     `activities_select`, RLS) et, si une formation est indiquée, lui
     appartenir : c'est elle qui reçoit la maîtrise. Les corrigés, eux,
     ne sont lisibles que par le client d'administration (migration
     0019) ; la tentative et la maîtrise s'écrivent de même. */
  const { data: activiteVisible } = await supabase
    .from("activities")
    .select("id, title, content, lesson:lessons(module:modules(version:course_versions(course_id)))")
    .eq("id", activityId)
    .maybeSingle();
  if (!activiteVisible) {
    return { error: "Ce QCM est introuvable ou ne vous est pas accessible." };
  }
  // Test de positionnement (PRD §9) : mesure sans récompense.
  const placement = estTestDePositionnement(activiteVisible.content);
  if (courseId) {
    const premierDe = <T,>(v: T | T[] | null | undefined): T | null =>
      Array.isArray(v) ? (v[0] ?? null) : (v ?? null);
    const coursDeLActivite = premierDe(
      premierDe(premierDe(activiteVisible.lesson)?.module)?.version
    )?.course_id;
    if (coursDeLActivite !== courseId) {
      return { error: "Ce QCM n'appartient pas à cette formation." };
    }
  }
  const admin = createAdminClient();

  /* Une copie déjà entre les mains d'un correcteur (lot 23) : on ne
     relance pas tant qu'elle n'est pas notée, sinon le formateur
     corrigerait des copies périmées. */
  const { data: enAttente } = await supabase
    .from("attempts")
    .select("id")
    .eq("activity_id", activityId)
    .eq("user_id", user.id)
    .eq("status", "pending_review")
    .limit(1)
    .maybeSingle();
  if (enAttente) {
    return {
      error:
        "Votre précédente réponse attend encore la correction d'un formateur. Vous pourrez retenter une fois la note reçue.",
    };
  }

  // Les bonnes réponses ne quittent jamais le serveur avant soumission.
  const { data: questionsBrutes, error: erreurQuestions } = await admin
    .from("questions")
    .select("id, type, prompt, options, expected_answer, explanation, competency_id")
    .eq("activity_id", activityId)
    .order("position");

  if (erreurQuestions || !questionsBrutes || questionsBrutes.length === 0) {
    return { error: "Ce QCM est introuvable ou ne contient aucune question." };
  }

  const questions: QuestionCorrigeable[] = questionsBrutes.map(lireQuestion);

  // Réponses selon le type : index d'option ou texte (lot 23).
  const reponses: Record<string, ReponseDonnee> = {};
  for (const q of questions) {
    const valeur = lireReponse(q.type, formData.get(`q_${q.id}`));
    if (valeur !== null) reponses[q.id] = valeur;
  }
  if (Object.keys(reponses).length === 0) {
    return { error: "Répondez à au moins une question avant de soumettre." };
  }

  const correction = corrigerQcm(questions, reponses);
  const attenteCorrecteur = tentativeEnAttente(correction);

  // Tentatives précédentes : série de bonnes réponses et meilleur score
  // avant celle-ci (pour l'XP et le badge Comeback).
  const { scoresPrecedents, meilleurAvant } = await tentativesPrecedentes(admin, user.id, activityId);

  const { data: tentative, error: erreurTentative } = await admin
    .from("attempts")
    .insert({
      activity_id: activityId,
      user_id: user.id,
      session_id: sessionId || null,
      answers: reponses,
      score: correction.scorePourcent,
      feedback: correction as unknown as Record<string, unknown>,
      status: attenteCorrecteur ? "pending_review" : "graded",
      submitted_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (erreurTentative || !tentative) {
    loguer("enregistrement de la tentative", erreurTentative);
    return { error: "La tentative n'a pas pu être enregistrée. Réessayez." };
  }

  // En session présentielle : signaler la réponse au formateur en direct.
  if (sessionId) {
    const { error: erreurEvenement } = await supabase.from("live_events").insert({
      session_id: sessionId,
      type: "attempt_submitted",
      payload: { activity_id: activityId, score: correction.scorePourcent, en_attente: attenteCorrecteur },
      created_by: user.id,
    });
    loguer("événement de session", erreurEvenement);
    revalidatePath(`/sessions/${sessionId}`);
    revalidatePath(`/sessions/${sessionId}/activite/${activityId}`);
  }

  // Maîtrise par compétence : les questions notées comptent dès
  // maintenant, les questions ouvertes attendront leur note.
  const competencesMontees = await mettreAJourMaitrise({
    admin,
    userId: user.id,
    courseId,
    activityId,
    placement,
    scoreTentative: correction.scorePourcent,
  });

  revalidatePath(`/formations/${courseId}/activite/${activityId}`);
  revalidatePath("/progression");

  // ---------- Copie à corriger (lot 23) ----------
  // Pas de score, donc ni XP ni badge pour l'instant : tout cela vient
  // avec la note du correcteur (`noterTentative`).
  if (attenteCorrecteur) {
    // Pré-correction IA (lot 26) : une proposition pour le formateur,
    // rangée hors de portée de l'apprenant ; jamais bloquante.
    let corrigee: { score: number; nbCorrectes: number; nbQuestions: number } | undefined;
    try {
      const pre = await precorrigerTentative({ attemptId: tentative.id as string, userId: user.id, activityId });
      if (!pre.ok) console.error("[ia] pré-correction non effectuée :", pre.motif);
      corrigee = pre.corrigee;
    } catch (e) {
      console.error("[ia] pré-correction :", e instanceof Error ? e.message : e);
    }
    // Corrigée automatiquement (lot 27) : résultat immédiat, pas de copie à corriger.
    if (corrigee) {
      revalidatePath(`/formations/${courseId}/activite/${activityId}`);
      revalidatePath("/progression");
      return {
        success: `Réponse corrigée : ${corrigee.score} % (${corrigee.nbCorrectes}/${corrigee.nbQuestions}). Le résultat et le commentaire s'affichent ci-dessus ; vous pouvez demander une relecture par un formateur.`,
      };
    }
    if (courseId) {
      const pluriel = correction.nbEnAttente > 1 ? "s" : "";
      await notifierEncadrementFormation(
        courseId,
        {
          type: "copie_a_corriger",
          title: `Copie à corriger : ${activiteVisible.title}`,
          body: `${user.fullName || "Un apprenant"} a répondu à ${correction.nbEnAttente} question${pluriel} ouverte${pluriel}.`,
          href: `/resultats/corrections/${tentative.id}`,
        },
        user.id
      );
    }
    revalidatePath("/resultats/corrections");
    const notees = correction.nbQuestions - correction.nbEnAttente;
    return {
      success: `Réponses enregistrées${
        notees > 0 ? ` : ${correction.nbCorrectes}/${notees} sur les questions corrigées automatiquement` : ""
      }. ${correction.nbEnAttente > 1 ? `${correction.nbEnAttente} réponses rédigées sont` : "Votre réponse rédigée est"} en cours de correction : vous serez prévenu.`,
    };
  }

  const score = correction.scorePourcent ?? 0;

  // ---------- Gamification (lot 14) ----------
  // Un test de positionnement mesure, il ne récompense pas : ni XP, ni
  // badge, ni série — sinon on inciterait à le « réussir » plutôt qu'à
  // répondre sincèrement.
  if (placement) {
    revalidatePath(`/formations/${courseId}`);
    return {
      success: `Test de positionnement enregistré : ${score} % (${correction.nbCorrectes}/${correction.nbQuestions}). Votre point de départ par compétence s'affiche ci-dessous.`,
    };
  }
  const xpGagne = await gamifierTentative({
    admin,
    userId: user.id,
    courseId,
    activityId,
    sessionId: sessionId || null,
    attemptId: tentative.id as string,
    scorePourcent: score,
    nbQuestions: questions.length,
    dureeSecondes,
    scoresPrecedents,
    meilleurAvant,
    competencesMontees,
  });

  revalidatePath("/badges");
  return {
    success: `Score : ${score} % (${correction.nbCorrectes}/${correction.nbQuestions}).${
      xpGagne > 0 ? ` +${xpGagne} XP.` : ""
    } Le détail corrigé s'affiche ci-dessous.`,
  };
}

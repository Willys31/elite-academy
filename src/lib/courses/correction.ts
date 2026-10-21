import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { appliquerNotes, type ResultatCorrection } from "@/lib/courses/progression";
import { estTestDePositionnement } from "@/lib/courses/positionnement";
import { formationDeLActivite, mettreAJourMaitrise } from "@/lib/courses/maitrise";
import type { NoteCorrecteur } from "@/lib/courses/questions";
import { ecartProposition, type PropositionsCopie } from "@/lib/ai/precorrection";
import { gamifierTentative, tentativesPrecedentes } from "@/lib/gamification/tentative";
import { emettreNotification } from "@/lib/notifications/emettre";
import type { DecisionCopie } from "@/lib/courses/correction-auto";

/**
 * Enregistrement d'une correction de réponses rédigées — commun à la
 * correction automatique (`corrigerTentativeAutomatiquement`, lot 27),
 * à la décision d'un formateur sur une copie en repli (`noterTentative`)
 * et à la révision d'une copie déjà notée (`reviserTentative`).
 *
 * Écrit via le client d'administration : `attempts` n'a aucune politique
 * d'UPDATE. L'appelant a vérifié les droits avant d'arriver ici.
 */
export interface TentativeACorriger {
  id: string;
  user_id: string;
  activity_id: string;
  session_id: string | null;
  status: string;
  feedback: ResultatCorrection;
}

export interface ParametresEnregistrement {
  admin: SupabaseClient;
  tentative: TentativeACorriger;
  notes: Record<string, NoteCorrecteur>;
  /** Membre de l'encadrement qui décide ; null = décision automatique. */
  decidePar: string | null;
  /** Révision d'une copie déjà notée : pas de nouvel XP, notification « révisée ». */
  revision?: boolean;
}

export type ResultatEnregistrement =
  | { ok: true; score: number; xp: number; hrefApprenant: string; nbCorrectes: number; nbQuestions: number }
  | { ok: false; erreur: string };

export async function enregistrerNotes(p: ParametresEnregistrement): Promise<ResultatEnregistrement> {
  const { admin, tentative, notes, decidePar } = p;
  const revision = Boolean(p.revision);

  const { correction, sansNote } = appliquerNotes(tentative.feedback, notes);
  if (sansNote.length > 0) {
    return { ok: false, erreur: `Indiquez « acquise » ou « non acquise » pour chaque réponse rédigée (${sansNote.length} sans note).` };
  }
  const score = correction.scorePourcent ?? 0;
  const maintenant = new Date().toISOString();
  const decisionPrecedente = (tentative.feedback as { decision?: DecisionCopie }).decision;
  const decision: DecisionCopie = revision
    ? { ...(decisionPrecedente ?? { mode: "humaine", le: maintenant }), revisee_le: maintenant }
    : { mode: decidePar ? "humaine" : "automatique", le: maintenant };

  const requete = admin
    .from("attempts")
    .update(
      {
        score,
        feedback: { ...correction, decision } as unknown as Record<string, unknown>,
        status: "graded",
        graded_by: decidePar,
        graded_at: maintenant,
      },
      { count: "exact" }
    )
    .eq("id", tentative.id);
  const { error: erreurMaj, count } = await (revision ? requete.eq("status", "graded") : requete.eq("status", "pending_review"));
  if (erreurMaj || count === 0) {
    return { ok: false, erreur: "La note n'a pas pu être enregistrée. Rechargez la page et réessayez." };
  }

  // Écart entre la proposition automatique et la décision : collecte
  // pour mesurer la fiabilité de la correction (lot 26).
  const { data: revue } = await admin.from("attempt_ai_reviews").select("id, proposal").eq("attempt_id", tentative.id).maybeSingle();
  if (revue) {
    const ecart = ecartProposition((revue.proposal ?? {}) as PropositionsCopie, notes);
    await admin
      .from("attempt_ai_reviews")
      .update({ validated_as_is: ecart.validatedAsIs, final_verdicts: ecart.finalVerdicts, decided_by: decidePar, decided_at: maintenant })
      .eq("id", revue.id);
  }

  const [cours, { data: activite }] = await Promise.all([
    formationDeLActivite(admin, tentative.activity_id),
    admin.from("activities").select("title, content").eq("id", tentative.activity_id).maybeSingle(),
  ]);
  const courseId = cours?.id ?? "";
  const placement = estTestDePositionnement(activite?.content);

  const competencesMontees = await mettreAJourMaitrise({
    admin,
    userId: tentative.user_id,
    courseId,
    activityId: tentative.activity_id,
    placement,
    scoreTentative: score,
  });

  // Points, badges, série : une seule fois par copie, jamais à la révision
  // ni pour un test de positionnement.
  let xp = 0;
  if (!placement && !revision) {
    const { scoresPrecedents, meilleurAvant } = await tentativesPrecedentes(admin, tentative.user_id, tentative.activity_id, tentative.id);
    xp = await gamifierTentative({
      admin,
      userId: tentative.user_id,
      courseId,
      activityId: tentative.activity_id,
      sessionId: tentative.session_id,
      attemptId: tentative.id,
      scorePourcent: score,
      nbQuestions: correction.nbQuestions,
      dureeSecondes: null,
      scoresPrecedents,
      meilleurAvant,
      competencesMontees,
    });
  }

  const hrefApprenant = courseId
    ? `/formations/${courseId}/activite/${tentative.activity_id}`
    : tentative.session_id
      ? `/sessions/${tentative.session_id}/activite/${tentative.activity_id}`
      : "/revision";
  await emettreNotification({
    userId: tentative.user_id,
    organizationId: cours?.organization_id ?? null,
    type: "copie_notee",
    title: `${revision ? "Correction révisée" : "Réponse corrigée"} : ${activite?.title ?? "activité"}`,
    body: `Résultat : ${score} % (${correction.nbCorrectes}/${correction.nbQuestions}).${xp > 0 ? ` +${xp} XP.` : ""} Le commentaire est visible sur l'activité et dans Ma révision.`,
    href: hrefApprenant,
  });

  return { ok: true, score, xp, hrefApprenant, nbCorrectes: correction.nbCorrectes, nbQuestions: correction.nbQuestions };
}

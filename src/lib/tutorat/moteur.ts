import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import {
  bandeDeBlocage,
  doitAlerter,
  reductionRecompensee,
  scoreDeBlocage,
  typesDeBlocage,
  SCORE_ECHEC,
} from "@/lib/tutorat/blocage";
import { attribuerXp, incrementerCompteurs, verifierBadges } from "@/lib/gamification/moteur";
import { emettreNotification, notifierEncadrementFormation } from "@/lib/notifications/emettre";

/**
 * Moteur du tutorat – côté serveur uniquement.
 *
 * Recalcule le score de blocage d'une compétence à partir des aides
 * demandées (`tutor_help_events`) et des tentatives (`attempts`, via
 * `activity_competencies`), alerte l'encadrement au seuil, récompense
 * les déblocages. Écritures via le client d'administration : les
 * tables du tutorat n'ont aucune politique d'écriture utilisateur.
 */

type Admin = ReturnType<typeof createAdminClient>;

function loguer(operation: string, erreur: unknown) {
  if (erreur) console.error(`[tutorat] ${operation}`, erreur);
}

function admin(): Admin | null {
  try {
    return createAdminClient();
  } catch (erreur) {
    loguer("client admin", erreur);
    return null;
  }
}

export interface ScoreRecalcule {
  score: number | null;
  bande: string;
  types: string[];
}

export async function recalculerScoreBlocage(params: {
  userId: string;
  organizationId: string;
  courseId: string;
  competencyId: string;
}): Promise<ScoreRecalcule | null> {
  const client = admin();
  if (!client) return null;
  const { userId, organizationId, courseId, competencyId } = params;

  const [{ data: liens }, { data: aides }, { data: competence }, { data: existant }] = await Promise.all([
    client.from("activity_competencies").select("activity_id").eq("competency_id", competencyId),
    client
      .from("tutor_help_events")
      .select("help_type, activity_id")
      .eq("user_id", userId)
      .eq("course_id", courseId)
      .eq("competency_id", competencyId),
    client.from("competencies").select("domain").eq("id", competencyId).maybeSingle(),
    client
      .from("competency_blocking_scores")
      .select("score, history, alerted_at, nb_exercices_perso")
      .eq("user_id", userId)
      .eq("course_id", courseId)
      .eq("competency_id", competencyId)
      .maybeSingle(),
  ]);

  const idsActivites = (liens ?? []).map((l) => l.activity_id as string);
  const { data: tentatives } =
    idsActivites.length > 0
      ? await client
          .from("attempts")
          .select("score, submitted_at, started_at, answers")
          .eq("user_id", userId)
          .in("activity_id", idsActivites)
      : { data: [] };

  const lignesTentatives = (tentatives ?? []).map((t) => {
    const score = t.score === null ? null : Number(t.score);
    const nbQuestions = t.answers && typeof t.answers === "object" ? Object.keys(t.answers as object).length : 0;
    const duree =
      t.started_at && t.submitted_at
        ? (new Date(t.submitted_at as string).getTime() - new Date(t.started_at as string).getTime()) / 1000
        : null;
    return { score, dureeParQuestion: duree !== null && nbQuestions > 0 ? duree / nbQuestions : null };
  });

  const nbAides = (aides ?? []).filter((a) => a.help_type !== "reformulate").length;
  const nbReformulations = (aides ?? []).filter((a) => a.help_type === "reformulate").length;
  const nbEchecs = lignesTentatives.filter((t) => t.score !== null && t.score < SCORE_ECHEC).length;
  const nbTentatives = lignesTentatives.length;

  const score = scoreDeBlocage({ nbAides, nbReformulations, nbEchecs, nbTentatives });
  const bande = bandeDeBlocage(score).bande;
  const types = typesDeBlocage({
    aides: (aides ?? []) as Array<{ help_type: string }>,
    tentatives: lignesTentatives,
    domaineCompetence: (competence?.domain as string) ?? null,
  });

  const scoreAvant = existant?.score === null || existant?.score === undefined ? null : Number(existant.score);
  const history = Array.isArray(existant?.history) ? (existant!.history as number[]) : [];
  const nouvelHistorique = score === null ? history : [...history, score].slice(-10);
  const alerte = doitAlerter(scoreAvant, score, Boolean(existant?.alerted_at));

  const { error } = await client.from("competency_blocking_scores").upsert(
    {
      user_id: userId,
      course_id: courseId,
      competency_id: competencyId,
      score,
      band: bande,
      blocking_types: types,
      nb_aides: nbAides,
      nb_reformulations: nbReformulations,
      nb_echecs: nbEchecs,
      nb_tentatives: nbTentatives,
      nb_exercices_perso: existant?.nb_exercices_perso ?? 0,
      history: nouvelHistorique,
      computed_at: new Date().toISOString(),
      alerted_at: alerte ? new Date().toISOString() : (existant?.alerted_at ?? null),
    },
    { onConflict: "user_id,course_id,competency_id" }
  );
  loguer("score de blocage", error);

  if (alerte) {
    const [{ data: profil }, { data: comp }] = await Promise.all([
      client.from("profiles").select("full_name").eq("id", userId).maybeSingle(),
      client.from("competencies").select("name").eq("id", competencyId).maybeSingle(),
    ]);
    await notifierEncadrementFormation(courseId, {
      type: "alerte_blocage",
      title: `${(profil?.full_name as string) || "Un apprenant"} a un score de blocage de ${score} sur « ${(comp?.name as string) ?? "une compétence"} »`,
      body: bandeDeBlocage(score).action,
      href: `/resultats?formation=${courseId}`,
    });
  }

  const gain = reductionRecompensee(scoreAvant, score);
  if (gain > 0) {
    const credite = await attribuerXp({
      userId,
      organizationId,
      type: "deblocage",
      montant: gain,
      courseId,
      details: { competency_id: competencyId, avant: scoreAvant, apres: score },
    });
    if (credite > 0) {
      await emettreNotification({
        userId,
        organizationId,
        type: "deblocage",
        title: "Blocage en recul",
        body: `Votre score de blocage est passé de ${scoreAvant} à ${score}. +${gain} XP.`,
        href: `/tutorat?formation=${courseId}`,
      });
    }
    // Éclairé : un blocage important surmonté grâce aux exercices personnalisés.
    if (scoreAvant !== null && scoreAvant >= 0.6 && score !== null && score < 0.4 && (existant?.nb_exercices_perso ?? 0) > 0) {
      await incrementerCompteurs(userId, { eclaire: 1 });
      await verifierBadges(userId, organizationId);
    }
  }

  return { score, bande, types };
}

/** Incrémente le compteur d'exercices personnalisés terminés d'une compétence. */
export async function compterExercicePerso(params: {
  userId: string;
  courseId: string;
  competencyId: string;
}): Promise<void> {
  const client = admin();
  if (!client) return;
  const { data } = await client
    .from("competency_blocking_scores")
    .select("nb_exercices_perso")
    .eq("user_id", params.userId)
    .eq("course_id", params.courseId)
    .eq("competency_id", params.competencyId)
    .maybeSingle();
  await client.from("competency_blocking_scores").upsert(
    {
      user_id: params.userId,
      course_id: params.courseId,
      competency_id: params.competencyId,
      nb_exercices_perso: Number(data?.nb_exercices_perso ?? 0) + 1,
    },
    { onConflict: "user_id,course_id,competency_id" }
  );
}

/** Nombre de générations IA d'un type pour un utilisateur depuis minuit UTC. */
export async function generationsDuJour(userId: string, types: string[]): Promise<number> {
  const client = admin();
  if (!client) return 0;
  const debut = new Date();
  debut.setUTCHours(0, 0, 0, 0);
  const { count } = await client
    .from("ai_generations")
    .select("id", { count: "exact", head: true })
    .eq("requested_by", userId)
    .in("generation_type", types)
    .gte("created_at", debut.toISOString());
  return count ?? 0;
}

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/profile";
import { NIVEAU_CALCULE_LABELS } from "@/lib/courses/progression";
import { lireTentative, questionsARevoir } from "@/lib/courses/revision";
import {
  CransMaitrise,
  EcranTitre,
  Etiquette,
  LienOr,
  LienSobre,
  Panneau,
  SectionTitre,
  Vide,
} from "@/components/app";

export const metadata: Metadata = { title: "Ma révision" };

/** Lien d'une activité vers son QCM, une fois la formation retrouvée. */
interface ActiviteSituee {
  activityId: string;
  titreActivite: string;
  titreLecon: string;
  courseId: string | null;
  titreCours: string;
}

interface QuestionAffichee {
  questionId: string;
  enonce: string;
  options: string[];
  reponseDonnee: number | null;
  bonneReponse: number;
  explication: string | null;
}

/**
 * Ma révision.
 *
 * L'écran ne redonne pas le cours : il reprend exactement les questions
 * restées fausses au dernier essai, avec la bonne réponse et son
 * explication, puis renvoie vers le QCM pour retenter. C'est le trajet
 * le plus court entre « je me suis trompé » et « j'ai compris ».
 *
 * Les bonnes réponses sont affichées ici en connaissance de cause :
 * l'apprenant a déjà soumis sa tentative et le serveur la lui a déjà
 * corrigée. Rien n'est divulgué qu'il ne puisse déjà voir.
 */
export default async function RevisionPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/connexion");

  const supabase = await createClient();

  const [{ data: tentatives }, { data: progres }] = await Promise.all([
    supabase
      .from("attempts")
      .select("activity_id, score, submitted_at, started_at, feedback")
      .eq("user_id", user.id),
    supabase
      .from("progress_records")
      .select(
        "mastery_level, score, competency:competencies(id, name, domain), course:courses(id, title)"
      )
      .eq("user_id", user.id)
      .not("competency_id", "is", null)
      .order("updated_at", { ascending: false }),
  ]);

  const aRevoir = questionsARevoir((tentatives ?? []).map(lireTentative));

  /* Compétences à consolider : celles qui n'ont pas encore de niveau, ou
     qui plafonnent aux fondamentaux. Elles répondent à « par quoi
     commencer ? » quand la liste de questions est longue. */
  const competencesFaibles = (progres ?? [])
    .map((p) => {
      const comp = Array.isArray(p.competency) ? p.competency[0] : p.competency;
      const course = Array.isArray(p.course) ? p.course[0] : p.course;
      if (!comp) return null;
      return {
        id: comp.id as string,
        nom: comp.name as string,
        domaine: (comp.domain as string) ?? "",
        niveau: p.mastery_level as string | null,
        score: p.score === null ? null : Number(p.score),
        courseId: course?.id ?? null,
        titreCours: course?.title ?? "",
      };
    })
    .filter(Boolean)
    .filter(
      (c) => c!.niveau === null || c!.niveau === "fundamentals"
    ) as Array<{
    id: string;
    nom: string;
    domaine: string;
    niveau: string | null;
    score: number | null;
    courseId: string | null;
    titreCours: string;
  }>;

  if (aRevoir.length === 0) {
    return (
      <div>
        <EnTeteRevision nbQuestions={0} />
        <Vide
          titre="Rien à revoir pour le moment"
          texte="Toutes les questions de vos derniers essais sont justes. Continuez vos formations : les questions manquées apparaîtront ici automatiquement."
          action={<LienOr href="/formations">Reprendre une formation</LienOr>}
        />
        {competencesFaibles.length > 0 ? (
          <div className="mt-10">
            <CompetencesAConsolider liste={competencesFaibles} />
          </div>
        ) : null}
      </div>
    );
  }

  /* Récupération des énoncés et du contexte. Deux requêtes seulement :
     les questions (avec leur activité, sa leçon, son module et la
     formation), puis rien d'autre — le reste est de la mise en forme. */
  const idsQuestions = aRevoir.map((q) => q.questionId);
  const { data: questions } = await supabase
    .from("questions")
    .select(
      "id, prompt, options, activity_id, activity:activities(id, title, lesson:lessons(id, title, module:modules(id, course_version:course_versions(course_id, course:courses(id, title)))))"
    )
    .in("id", idsQuestions);

  const situationParActivite = new Map<string, ActiviteSituee>();
  const detailQuestion = new Map<
    string,
    { enonce: string; options: string[]; activityId: string }
  >();

  for (const q of questions ?? []) {
    const activite = premier(q.activity);
    const lecon = activite ? premier(activite.lesson) : null;
    const module = lecon ? premier(lecon.module) : null;
    const version = module ? premier(module.course_version) : null;
    const cours = version ? premier(version.course) : null;

    detailQuestion.set(q.id, {
      enonce: q.prompt,
      options: Array.isArray(q.options) ? (q.options as string[]) : [],
      activityId: q.activity_id,
    });

    if (!situationParActivite.has(q.activity_id)) {
      situationParActivite.set(q.activity_id, {
        activityId: q.activity_id,
        titreActivite: activite?.title ?? "Questionnaire",
        titreLecon: lecon?.title ?? "",
        courseId: cours?.id ?? version?.course_id ?? null,
        titreCours: cours?.title ?? "",
      });
    }
  }

  /* Regroupement par activité : réviser trois questions du même QCM à la
     suite a du sens, les mélanger avec celles d'une autre formation n'en
     a aucun. */
  const groupes = new Map<string, QuestionAffichee[]>();
  for (const q of aRevoir) {
    const detail = detailQuestion.get(q.questionId);
    if (!detail) continue; // question supprimée depuis la tentative
    const liste = groupes.get(detail.activityId) ?? [];
    liste.push({
      questionId: q.questionId,
      enonce: detail.enonce,
      options: detail.options,
      reponseDonnee: q.reponseDonnee,
      bonneReponse: q.bonneReponse,
      explication: q.explication,
    });
    groupes.set(detail.activityId, liste);
  }

  const nbQuestions = [...groupes.values()].reduce((n, l) => n + l.length, 0);

  return (
    <div>
      <EnTeteRevision nbQuestions={nbQuestions} />

      <div className="space-y-6">
        {[...groupes.entries()].map(([activityId, liste]) => {
          const situation = situationParActivite.get(activityId);
          const lienQcm =
            situation?.courseId
              ? `/formations/${situation.courseId}/activite/${activityId}`
              : null;

          return (
            <Panneau key={activityId} flush>
              {/* En-tête du groupe : où l'on est, et comment retenter. */}
              <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3 border-b border-sand-200 p-5">
                <div className="min-w-0">
                  {situation?.titreCours ? (
                    <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                      {situation.titreCours}
                      {situation.titreLecon ? ` · ${situation.titreLecon}` : ""}
                    </p>
                  ) : null}
                  <h2 className="mt-1 font-display text-lg font-semibold text-ink-900">
                    {situation?.titreActivite ?? "Questionnaire"}
                  </h2>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <Etiquette ton="alerte">
                    {liste.length} question{liste.length > 1 ? "s" : ""}
                  </Etiquette>
                  {lienQcm ? <LienSobre href={lienQcm}>Retenter</LienSobre> : null}
                </div>
              </div>

              <ol className="divide-y divide-sand-200">
                {liste.map((q, i) => (
                  <li key={q.questionId} className="p-5">
                    <div className="flex gap-4">
                      <span
                        aria-hidden
                        className="shrink-0 font-display text-lg font-semibold text-sand-200"
                      >
                        {String(i + 1).padStart(2, "0")}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="font-medium leading-relaxed text-ink-900">
                          {q.enonce}
                        </p>

                        <div className="mt-4 space-y-2">
                          {/* Ce qui a été répondu, puis ce qu'il fallait
                              répondre. L'ordre compte : on se corrige plus
                              vite en voyant d'abord son propre raisonnement. */}
                          {q.reponseDonnee !== null &&
                          q.options[q.reponseDonnee] !== undefined ? (
                            <p className="flex gap-2.5 rounded-lg bg-red-50 px-3.5 py-2.5 text-sm text-red-900">
                              <span aria-hidden className="shrink-0 font-semibold">
                                ✕
                              </span>
                              <span>
                                <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-red-700/70">
                                  Votre réponse
                                </span>
                                <br />
                                {q.options[q.reponseDonnee]}
                              </span>
                            </p>
                          ) : (
                            <p className="rounded-lg bg-sand-100 px-3.5 py-2.5 text-sm text-slate-500">
                              Vous n&apos;aviez pas répondu à cette question.
                            </p>
                          )}

                          {q.options[q.bonneReponse] !== undefined ? (
                            <p className="flex gap-2.5 rounded-lg bg-emerald-50 px-3.5 py-2.5 text-sm text-emerald-900">
                              <span aria-hidden className="shrink-0 font-semibold">
                                ✓
                              </span>
                              <span>
                                <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-emerald-700/70">
                                  Bonne réponse
                                </span>
                                <br />
                                {q.options[q.bonneReponse]}
                              </span>
                            </p>
                          ) : null}
                        </div>

                        {q.explication ? (
                          <p className="mt-4 border-l-2 border-gold-400 pl-4 text-sm leading-relaxed text-slate-600">
                            {q.explication}
                          </p>
                        ) : null}
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
            </Panneau>
          );
        })}
      </div>

      {competencesFaibles.length > 0 ? (
        <div className="mt-10">
          <CompetencesAConsolider liste={competencesFaibles} />
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------
   Fragments
   ------------------------------------------------------------------ */

function EnTeteRevision({ nbQuestions }: { nbQuestions: number }) {
  return (
    <EcranTitre
      eyebrow="Ce qu'il reste à comprendre"
      intro="Les questions restées fausses à votre dernier essai, avec la bonne réponse et son explication. Une question réussie depuis disparaît d'elle-même de cette liste."
      action={
        nbQuestions > 0 ? (
          <Etiquette ton="alerte">
            {nbQuestions} question{nbQuestions > 1 ? "s" : ""}
          </Etiquette>
        ) : undefined
      }
    >
      Ma révision
    </EcranTitre>
  );
}

function CompetencesAConsolider({
  liste,
}: {
  liste: Array<{
    id: string;
    nom: string;
    domaine: string;
    niveau: string | null;
    score: number | null;
    courseId: string | null;
    titreCours: string;
  }>;
}) {
  return (
    <section>
      <SectionTitre
        compte={liste.length}
        action={<LienSobre href="/progression">Voir ma progression</LienSobre>}
      >
        Compétences à consolider
      </SectionTitre>
      <Panneau flush>
        <ul className="divide-y divide-sand-200">
          {liste.map((c) => (
            <li
              key={`${c.courseId}-${c.id}`}
              className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-5 py-3.5"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium text-ink-900">{c.nom}</p>
                <p className="text-xs text-slate-400">
                  {[c.domaine, c.titreCours].filter(Boolean).join(" · ")}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                {c.score !== null ? (
                  <span className="text-xs text-slate-500">{c.score} %</span>
                ) : null}
                <span className="text-xs text-slate-500">
                  {c.niveau
                    ? (NIVEAU_CALCULE_LABELS[c.niveau] ?? c.niveau)
                    : "En cours d'acquisition"}
                </span>
                <CransMaitrise niveau={c.niveau} />
              </div>
            </li>
          ))}
        </ul>
      </Panneau>
    </section>
  );
}

/**
 * Supabase renvoie une relation imbriquée tantôt comme objet, tantôt
 * comme tableau à un élément selon la forme de la requête. Ce petit
 * adaptateur évite de répéter le test à chaque niveau d'imbrication.
 */
function premier<T>(valeur: T | T[] | null | undefined): T | null {
  if (Array.isArray(valeur)) return valeur[0] ?? null;
  return valeur ?? null;
}

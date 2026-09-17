import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/profile";
import { NIVEAU_CALCULE_LABELS } from "@/lib/courses/progression";
import {
  VUE_REVISION_LABELS,
  competenceAcquise,
  lireTentative,
  lireVueRevision,
  questionsAcquises,
  questionsARevoir,
  type VueRevision,
} from "@/lib/courses/revision";
import { CransMaitrise, EcranTitre, Etiquette, LienOr, LienSobre, Panneau, Retour, SectionTitre, Vide } from "@/components/app";

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

interface CompetenceResumee {
  id: string;
  nom: string;
  domaine: string;
  niveau: string | null;
  score: number | null;
  courseId: string | null;
  titreCours: string;
}

/**
 * Ma révision.
 *
 * Deux volets, choisis par `?vue=` :
 *
 * - « À retravailler » (par défaut) reprend exactement les questions
 *   restées fausses au dernier essai, avec la bonne réponse et son
 *   explication, puis renvoie vers le QCM pour retenter. C'est le trajet
 *   le plus court entre « je me suis trompé » et « j'ai compris ».
 * - « Notions acquises » reprend les questions réussies au dernier
 *   essai, sous forme de fiches à relire : ce que l'on sait s'entretient.
 *
 * Les deux listes partent de la dernière tentative de chaque activité
 * et se partagent donc les questions sans recouvrement.
 *
 * Les bonnes réponses sont affichées ici en connaissance de cause :
 * l'apprenant a déjà soumis sa tentative et le serveur la lui a déjà
 * corrigée. Rien n'est divulgué qu'il ne puisse déjà voir.
 */
export default async function RevisionPage({
  searchParams,
}: {
  searchParams: Promise<{ vue?: string | string[] }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/connexion");

  const vue = lireVueRevision((await searchParams).vue);
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

  const lues = (tentatives ?? []).map(lireTentative);
  const aRevoir = questionsARevoir(lues);
  const acquises = questionsAcquises(lues);
  const selection = vue === "acquises" ? acquises : aRevoir;

  /* Compétences : celles qui n'ont pas encore de niveau ou plafonnent aux
     fondamentaux sont à consolider ; les autres sont acquises. Elles
     répondent à « par quoi commencer ? » quand la liste est longue. */
  const competences = (progres ?? [])
    .map((p): CompetenceResumee | null => {
      const comp = premier(p.competency);
      const course = premier(p.course);
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
    .filter((c): c is CompetenceResumee => c !== null);

  const competencesDuVolet = competences.filter(
    (c) => competenceAcquise(c.niveau) === (vue === "acquises")
  );

  /* Récupération des énoncés et du contexte, pour le seul volet affiché.
     Une requête : les questions avec leur activité, sa leçon, son module
     et la formation — le reste est de la mise en forme. */
  const situationParActivite = new Map<string, ActiviteSituee>();
  const detailQuestion = new Map<
    string,
    { enonce: string; options: string[]; activityId: string }
  >();

  if (selection.length > 0) {
    const { data: questions } = await supabase
      .from("questions")
      .select(
        "id, prompt, options, activity_id, activity:activities(id, title, lesson:lessons(id, title, module:modules(id, course_version:course_versions(course_id, course:courses(id, title)))))"
      )
      .in(
        "id",
        selection.map((q) => q.questionId)
      );

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
  }

  /* Regroupement par activité : réviser trois questions du même QCM à la
     suite a du sens, les mélanger avec celles d'une autre formation n'en
     a aucun. */
  const groupes = new Map<string, QuestionAffichee[]>();
  for (const q of selection) {
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

  const estAcquis = vue === "acquises";

  return (
    <div>
      <Retour href="/accueil" />
      <EcranTitre
        eyebrow={estAcquis ? "Ce que vous savez déjà" : "Ce qu'il reste à comprendre"}
        intro={
          estAcquis
            ? "Les questions réussies à votre dernier essai, avec leur réponse et son explication. Relisez-les de temps en temps : ce que l'on sait s'entretient."
            : "Les questions restées fausses à votre dernier essai, avec la bonne réponse et son explication. Une question réussie depuis passe d'elle-même dans les notions acquises."
        }
      >
        Ma révision
      </EcranTitre>

      <ChoixVolet vue={vue} nbARevoir={aRevoir.length} nbAcquises={acquises.length} />

      {groupes.size === 0 ? (
        estAcquis ? (
          <Vide
            titre="Aucune notion acquise pour l'instant"
            texte="Les questions que vous réussissez à vos questionnaires apparaîtront ici, prêtes à être relues."
            action={<LienOr href="/formations">Reprendre une formation</LienOr>}
          />
        ) : (
          <Vide
            titre="Rien à retravailler pour le moment"
            texte="Toutes les questions de vos derniers essais sont justes. Continuez vos formations : les questions manquées apparaîtront ici automatiquement."
            action={
              acquises.length > 0 ? (
                <LienOr href="/revision?vue=acquises">Relire mes notions acquises</LienOr>
              ) : (
                <LienOr href="/formations">Reprendre une formation</LienOr>
              )
            }
          />
        )
      ) : (
        <div className="space-y-6">
          {[...groupes.entries()].map(([activityId, liste]) => {
            const situation = situationParActivite.get(activityId);
            const lienQcm = situation?.courseId
              ? `/formations/${situation.courseId}/activite/${activityId}`
              : null;

            return (
              <Panneau key={activityId} flush>
                {/* En-tête du groupe : où l'on est, et comment s'exercer. */}
                <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3 border-b border-sand-200 p-5">
                  <div className="min-w-0">
                    {situation?.titreCours ? (
                      <p className="text-xs font-medium text-slate-400">
                        {situation.titreCours}
                        {situation.titreLecon ? ` · ${situation.titreLecon}` : ""}
                      </p>
                    ) : null}
                    <h2 className="mt-1 font-display text-lg font-semibold text-ink-900">
                      {situation?.titreActivite ?? "Questionnaire"}
                    </h2>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <Etiquette ton={estAcquis ? "succes" : "alerte"}>
                      {liste.length} {estAcquis ? "notion" : "question"}
                      {liste.length > 1 ? "s" : ""}
                    </Etiquette>
                    {lienQcm ? (
                      <LienSobre href={lienQcm}>
                        {estAcquis ? "Refaire le QCM" : "Retenter"}
                      </LienSobre>
                    ) : null}
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
                            {estAcquis ? null : (
                              <ReponseDonnee question={q} />
                            )}

                            {q.options[q.bonneReponse] !== undefined ? (
                              <p className="flex gap-2.5 rounded-lg bg-emerald-50 px-3.5 py-2.5 text-sm text-emerald-900">
                                <span aria-hidden className="shrink-0 font-semibold">
                                  ✓
                                </span>
                                <span>
                                  <span className="text-xs font-medium text-emerald-700/70">
                                    {estAcquis
                                      ? "Votre réponse, la bonne"
                                      : "Bonne réponse"}
                                  </span>
                                  <br />
                                  {q.options[q.bonneReponse]}
                                </span>
                              </p>
                            ) : null}
                          </div>

                          {q.explication ? (
                            <p className="mt-4 border-l-2 border-brand-300 pl-4 text-sm leading-relaxed text-slate-600">
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
      )}

      {competencesDuVolet.length > 0 ? (
        <div className="mt-10">
          <ListeCompetences
            titre={estAcquis ? "Compétences acquises" : "Compétences à consolider"}
            liste={competencesDuVolet}
          />
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------
   Fragments
   ------------------------------------------------------------------ */

/**
 * Bascule entre les deux volets. Ce sont de simples liens (`?vue=`) :
 * la page reste un composant serveur, l'adresse se partage et le bouton
 * « précédent » du navigateur fonctionne.
 */
function ChoixVolet({
  vue,
  nbARevoir,
  nbAcquises,
}: {
  vue: VueRevision;
  nbARevoir: number;
  nbAcquises: number;
}) {
  const volets: Array<{ cle: VueRevision; href: string; compte: number }> = [
    { cle: "a-retravailler", href: "/revision", compte: nbARevoir },
    { cle: "acquises", href: "/revision?vue=acquises", compte: nbAcquises },
  ];

  return (
    <nav aria-label="Volets de la révision" className="mb-6">
      <ul className="inline-flex max-w-full gap-1 rounded-xl border border-sand-200 bg-white p-1">
        {volets.map((v) => {
          const actif = v.cle === vue;
          const tonCompte =
            v.cle === "acquises"
              ? "bg-brand-100 text-brand-800"
              : "bg-red-50 text-red-700";
          return (
            <li key={v.cle} className="min-w-0">
              <Link
                href={v.href}
                aria-current={actif ? "page" : undefined}
                className={`inline-flex min-h-11 items-center gap-2 rounded-lg px-3.5 text-sm font-medium transition-colors duration-150 lg:min-h-10 ${
                  actif
                    ? "bg-brand-50 text-brand-800"
                    : "text-slate-600 hover:bg-sand-100 hover:text-ink-900"
                }`}
              >
                <span className="truncate">{VUE_REVISION_LABELS[v.cle]}</span>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums ${
                    v.compte > 0 ? tonCompte : "bg-sand-100 text-slate-500"
                  }`}
                >
                  {v.compte}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** Ce qui a été répondu, avant ce qu'il fallait répondre. L'ordre compte :
    on se corrige plus vite en voyant d'abord son propre raisonnement. */
function ReponseDonnee({ question: q }: { question: QuestionAffichee }) {
  if (q.reponseDonnee !== null && q.options[q.reponseDonnee] !== undefined) {
    return (
      <p className="flex gap-2.5 rounded-lg bg-red-50 px-3.5 py-2.5 text-sm text-red-900">
        <span aria-hidden className="shrink-0 font-semibold">
          ✕
        </span>
        <span>
          <span className="text-xs font-medium text-red-700/70">Votre réponse</span>
          <br />
          {q.options[q.reponseDonnee]}
        </span>
      </p>
    );
  }
  return (
    <p className="rounded-lg bg-sand-100 px-3.5 py-2.5 text-sm text-slate-500">
      Vous n&apos;aviez pas répondu à cette question.
    </p>
  );
}

function ListeCompetences({
  titre,
  liste,
}: {
  titre: string;
  liste: CompetenceResumee[];
}) {
  return (
    <section>
      <SectionTitre
        compte={liste.length}
        action={<LienSobre href="/progression">Voir ma progression</LienSobre>}
      >
        {titre}
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

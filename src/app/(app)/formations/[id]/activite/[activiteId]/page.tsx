import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/profile";
import { donneAcces } from "@/lib/courses/inscriptions";
import {
  bilanPositionnement,
  estTestDePositionnement,
  VERDICT_CONSEILS,
  VERDICT_LABELS,
} from "@/lib/courses/positionnement";
import { soumettreQcm } from "@/app/(app)/formations/actions";
import type { ResultatCorrection } from "@/lib/courses/progression";
import { estEnAttenteDeCorrection, lireTypeQuestion } from "@/lib/courses/questions";
import { ChampReponse, LigneFeedback } from "@/components/activites/ChampReponse";
import { iaConfiguree, modeSimulation } from "@/lib/ai/client";
import { MAX_AIDES_PAR_JOUR, TYPE_AIDE_LABELS, type TypeAide } from "@/lib/tutorat/blocage";
import { generationsDuJour } from "@/lib/tutorat/moteur";
import { BoutonsAide } from "@/components/tutorat/BoutonsAide";
import { AuthForm } from "@/components/ui/AuthForm";
import { Icone } from "@/components/icons";
import { Alert, Badge, Card, PageTitle } from "@/components/ui";

export const metadata: Metadata = { title: "Activité" };

/**
 * Passage d'un QCM (UX/UI §3.5) : consigne, questions, soumission,
 * feedback corrigé. Les bonnes réponses ne sont jamais envoyées au
 * navigateur avant soumission (correction côté serveur).
 *
 * Quatre types de questions (lot 23) : choix unique, vrai/faux et
 * réponse courte sont corrigés à la soumission ; une question ouverte
 * attend la note d'un formateur, et la tentative reste « en attente »
 * jusque-là — pas de nouvel essai entre-temps.
 */
export default async function ActivitePage({
  params,
}: {
  params: Promise<{ id: string; activiteId: string }>;
}) {
  const { id, activiteId } = await params;
  const user = await getCurrentUser();
  if (!user) redirect("/connexion");

  const supabase = await createClient();
  const { data: formation } = await supabase
    .from("courses")
    .select("id, title")
    .eq("id", id)
    .maybeSingle();
  if (!formation) notFound();

  // Une inscription retirée ou suspendue existe toujours en base :
  // c'est son statut, pas sa présence, qui ouvre le contenu.
  const { data: inscription } = await supabase
    .from("enrollments")
    .select("id, status")
    .eq("course_id", formation.id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!inscription || !donneAcces(inscription.status)) {
    redirect(`/catalogue/${formation.id}`);
  }

  const { data: activite } = await supabase
    .from("activities")
    .select(
      "id, title, type, instructions, difficulty, lesson_id, content, activity_competencies(competency:competencies(name))"
    )
    .eq("id", activiteId)
    .maybeSingle();
  if (!activite) notFound();
  const placement = estTestDePositionnement(activite.content);

  // IMPORTANT : expected_answer et explanation ne sont PAS sélectionnés ici
  // (et, depuis la migration 0019, ne sont plus lisibles par l'apprenant).
  const { data: questions } = await supabase
    .from("questions")
    .select("id, type, prompt, options, position, competency_id")
    .eq("activity_id", activite.id)
    .order("position");
  const nbOuvertes = (questions ?? []).filter((q) => lireTypeQuestion(q.type) === "open").length;

  // Bilan du test de positionnement : compétence de chaque question, et
  // nom des compétences concernées.
  const competenceParQuestion: Record<string, string | null> = {};
  for (const q of questions ?? []) competenceParQuestion[q.id] = (q.competency_id as string | null) ?? null;
  const idsCompetences = [...new Set(Object.values(competenceParQuestion).filter((v): v is string => Boolean(v)))];
  const { data: competencesBilan } =
    placement && idsCompetences.length > 0
      ? await supabase.from("competencies").select("id, name").in("id", idsCompetences)
      : { data: [] as Array<{ id: string; name: string }> };
  const nomCompetence = new Map((competencesBilan ?? []).map((c) => [c.id as string, c.name as string]));

  // Dernière tentative de l'apprenant (feedback corrigé).
  const { data: derniereTentative } = await supabase
    .from("attempts")
    .select("id, score, status, feedback, submitted_at, graded_at")
    .eq("activity_id", activite.id)
    .eq("user_id", user.id)
    .order("submitted_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const feedback = (derniereTentative?.feedback ?? null) as ResultatCorrection | null;
  const enAttente = estEnAttenteDeCorrection(derniereTentative?.status);

  const competences = (activite.activity_competencies ?? [])
    .map((ac) => {
      const c = Array.isArray(ac.competency) ? ac.competency[0] : ac.competency;
      return c?.name;
    })
    .filter(Boolean) as string[];

  // Tutorat IA (lot 18) : aides déjà demandées sur cette activité, quota du jour.
  const tuteurDisponible = iaConfiguree() || modeSimulation();
  const [{ data: aides }, aidesDuJour] = await Promise.all([
    supabase
      .from("tutor_help_events")
      .select("id, help_type, response_text, created_at, question_id")
      .eq("user_id", user.id)
      .eq("activity_id", activite.id)
      .order("created_at", { ascending: false })
      .limit(10),
    tuteurDisponible ? generationsDuJour(user.id, ["tutor_help"]) : Promise.resolve(0),
  ]);

  return (
    <div className="mx-auto max-w-3xl">
      <p className="mb-2 text-sm">
        <Link
          href={`/formations/${formation.id}/lecon/${activite.lesson_id}`}
          className="text-brand-600 hover:underline"
        >
          ← Retour à la leçon
        </Link>
      </p>
      <PageTitle>{activite.title}</PageTitle>

      <div className="-mt-4 mb-6 flex flex-wrap items-center gap-2 text-sm text-slate-500">
        {placement ? <Badge>🧭 Test de positionnement · sans XP</Badge> : <Badge>Difficulté {activite.difficulty}/5</Badge>}
        {competences.map((c) => (
          <Badge key={c}>{c}</Badge>
        ))}
      </div>

      {activite.instructions ? (
        <Card className="mb-6">
          <p className="text-sm text-slate-700">{activite.instructions}</p>
        </Card>
      ) : null}

      {derniereTentative && feedback ? (
        <Card className="mb-6 border-brand-200">
          <h2 className="font-semibold">
            {enAttente || derniereTentative.score === null
              ? "Dernière tentative : en attente de correction"
              : `Dernière tentative : ${Number(derniereTentative.score)} % (${feedback.nbCorrectes}/${feedback.nbQuestions})`}
          </h2>
          {enAttente ? (
            <p className="mt-1 text-sm text-slate-600">
              {/* Le message de l'action est perdu au rechargement (le
                  formulaire qui le porte est masqué tant que la copie
                  attend) : le bilan des questions corrigées
                  automatiquement est donc redit ici. */}
              {feedback.nbQuestions - feedback.nbEnAttente > 0
                ? `Réponses enregistrées : ${feedback.nbCorrectes}/${feedback.nbQuestions - feedback.nbEnAttente} sur les questions corrigées automatiquement. `
                : "Réponses enregistrées. "}
              Un formateur doit encore noter {feedback.nbEnAttente > 1 ? `${feedback.nbEnAttente} questions ouvertes` : "votre question ouverte"}.
              Vous recevrez une notification dès que la note sera posée.
            </p>
          ) : derniereTentative.graded_at ? (
            <p className="mt-1 text-sm text-slate-600">
              Notée par un formateur le{" "}
              {new Date(derniereTentative.graded_at as string).toLocaleDateString("fr-FR", { day: "numeric", month: "long" })}.
            </p>
          ) : null}
          <ul className="mt-3 space-y-2 text-sm">
            {feedback.details.map((d, i) => (
              <LigneFeedback key={d.questionId} detail={d} numero={i + 1} />
            ))}
          </ul>
          {placement ? (
            <div className="mt-4 border-t border-sand-200 pt-4">
              <h3 className="font-semibold text-ink-900">Votre point de départ, compétence par compétence</h3>
              <ul className="mt-2 space-y-2 text-sm">
                {bilanPositionnement(feedback.details, competenceParQuestion).map((b) => (
                  <li key={b.competencyId} className="rounded-lg border border-sand-200 bg-sand-50 px-3 py-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium">{nomCompetence.get(b.competencyId) ?? "Compétence"}</span>
                      <span className="text-xs text-slate-500">
                        {b.nbCorrectes}/{b.nbQuestions} · {b.pourcent} % · {VERDICT_LABELS[b.verdict]}
                      </span>
                    </div>
                    <p className="mt-1 text-slate-600">{VERDICT_CONSEILS[b.verdict]}</p>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-xs text-slate-500">
                Ce test fixe votre niveau initial ; il ne rapporte pas d&apos;XP. Les leçons et
                les QCM de la formation feront évoluer votre maîtrise.
              </p>
            </div>
          ) : enAttente ? null : (
            <p className="mt-3 text-xs text-slate-500">
              Vous pouvez refaire le QCM : seul votre meilleur score compte pour
              la maîtrise de la compétence.
            </p>
          )}
          {/* Entraide (lot 15) : après une tentative, l'apprenant peut
              partager son blocage, anonymement, avec ses pairs. */}
          {derniereTentative.score !== null && Number(derniereTentative.score) < 80 ? (
            <p className="mt-3 text-sm">
              <Link
                href={`/entraide/nouveau?formation=${formation.id}&activite=${activite.id}`}
                className="font-medium text-brand-700 underline decoration-brand-700/30 underline-offset-[3px] hover:text-brand-800"
              >
                Partager mon blocage avec mes pairs
              </Link>
            </p>
          ) : null}
        </Card>
      ) : null}

      {!questions || questions.length === 0 ? (
        <Alert kind="info">Ce QCM ne contient pas encore de question.</Alert>
      ) : enAttente ? (
        <Alert kind="info">
          Votre copie est entre les mains d&apos;un formateur. Vous pourrez
          retenter cette activité une fois la note reçue.
        </Alert>
      ) : (
        <Card>
          <AuthForm
            action={soumettreQcm}
            submitLabel={nbOuvertes > 0 ? "Envoyer mes réponses" : "Soumettre mes réponses"}
            pendingLabel={nbOuvertes > 0 ? "Envoi en cours…" : "Correction en cours…"}
          >
            <input type="hidden" name="course_id" value={formation.id} />
            <input type="hidden" name="activity_id" value={activite.id} />
            {/* Horodatage de l'affichage, pour le bonus de rapidité (lot 14). */}
            <input type="hidden" name="started_at" value={Date.now()} />
            {nbOuvertes > 0 ? (
              <p className="text-xs leading-relaxed text-slate-500">
                {nbOuvertes > 1 ? `${nbOuvertes} questions ouvertes seront notées` : "Une question ouverte sera notée"} par un formateur ;
                les autres sont corrigées immédiatement.
              </p>
            ) : null}
            <div className="space-y-6">
              {questions.map((q, i) => (
                <fieldset key={q.id}>
                  <legend className="mb-2 text-sm font-medium text-slate-900">
                    {i + 1}. {q.prompt}
                    {lireTypeQuestion(q.type) === "open" ? (
                      <span className="ml-2 text-xs font-normal text-slate-500">(réponse rédigée, notée par un formateur)</span>
                    ) : null}
                  </legend>
                  <ChampReponse question={q} />
                </fieldset>
              ))}
            </div>
          </AuthForm>
        </Card>
      )}

      {/* ---------- Tuteur IA (lot 18) ---------- */}
      {questions && questions.length > 0 ? (
        <Card className="mt-6">
          <h2 className="flex items-center gap-2 font-semibold">
            <Icone nom="robot" className="size-5 text-brand-700" />
            Besoin d&apos;aide ? Le tuteur explique, il ne donne pas la réponse.
          </h2>
          {tuteurDisponible ? (
            <div className="mt-4">
              <BoutonsAide
                activityId={activite.id}
                questions={questions.map((q) => ({ id: q.id, prompt: q.prompt }))}
                aUneTentative={Boolean(derniereTentative)}
                restantes={Math.max(0, MAX_AIDES_PAR_JOUR - aidesDuJour)}
              />
            </div>
          ) : (
            <p className="mt-2 text-sm text-slate-500">
              Le tuteur IA n&apos;est pas configuré sur cette installation. Vous pouvez partager votre blocage dans l&apos;Entraide.
            </p>
          )}
          {(aides ?? []).length > 0 ? (
            <details className="mt-4 text-sm">
              <summary className="cursor-pointer text-slate-500 hover:text-ink-900">
                Aides précédentes sur cette activité ({(aides ?? []).length})
              </summary>
              <ul className="mt-2 space-y-2">
                {(aides ?? []).map((a) => {
                  const numero = questions.findIndex((q) => q.id === a.question_id) + 1;
                  return (
                    <li key={a.id} className="rounded-lg border border-sand-200 bg-sand-50 p-3">
                      <p className="text-xs font-medium text-slate-500">
                        {TYPE_AIDE_LABELS[a.help_type as TypeAide] ?? a.help_type}
                        {numero > 0 ? ` · question ${numero}` : ""} ·{" "}
                        {new Date(a.created_at).toLocaleString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                      </p>
                      <p className="mt-1 whitespace-pre-line leading-relaxed text-ink-900">{a.response_text}</p>
                    </li>
                  );
                })}
              </ul>
            </details>
          ) : null}
        </Card>
      ) : null}
    </div>
  );
}

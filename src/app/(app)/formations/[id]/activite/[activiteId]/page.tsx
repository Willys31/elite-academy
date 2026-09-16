import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/profile";
import { donneAcces } from "@/lib/courses/inscriptions";
import { soumettreQcm } from "@/app/(app)/formations/actions";
import type { ResultatCorrection } from "@/lib/courses/progression";
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
      "id, title, type, instructions, difficulty, lesson_id, activity_competencies(competency:competencies(name))"
    )
    .eq("id", activiteId)
    .maybeSingle();
  if (!activite) notFound();

  // IMPORTANT : expected_answer et explanation ne sont PAS sélectionnés ici.
  const { data: questions } = await supabase
    .from("questions")
    .select("id, prompt, options, position")
    .eq("activity_id", activite.id)
    .order("position");

  // Dernière tentative de l'apprenant (feedback corrigé).
  const { data: derniereTentative } = await supabase
    .from("attempts")
    .select("id, score, feedback, submitted_at")
    .eq("activity_id", activite.id)
    .eq("user_id", user.id)
    .order("submitted_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const feedback = (derniereTentative?.feedback ?? null) as ResultatCorrection | null;

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
        <Badge>Difficulté {activite.difficulty}/5</Badge>
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
            Dernière tentative : {Number(derniereTentative.score)} % (
            {feedback.nbCorrectes}/{feedback.nbQuestions})
          </h2>
          <ul className="mt-3 space-y-2 text-sm">
            {feedback.details.map((d, i) => (
              <li
                key={d.questionId}
                className={`rounded-lg px-3 py-2 ${
                  d.correcte ? "bg-green-50 text-green-900" : "bg-red-50 text-red-900"
                }`}
              >
                Question {i + 1} : {d.correcte ? "correcte ✓" : "incorrecte ✗"}
                {d.explication ? (
                  <span className="mt-1 block text-slate-600">{d.explication}</span>
                ) : null}
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-slate-500">
            Vous pouvez refaire le QCM : seul votre meilleur score compte pour
            la maîtrise de la compétence.
          </p>
          {/* Entraide (lot 15) : après une tentative, l'apprenant peut
              partager son blocage, anonymement, avec ses pairs. */}
          {Number(derniereTentative.score) < 80 ? (
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
      ) : (
        <Card>
          <AuthForm
            action={soumettreQcm}
            submitLabel="Soumettre mes réponses"
            pendingLabel="Correction en cours…"
          >
            <input type="hidden" name="course_id" value={formation.id} />
            <input type="hidden" name="activity_id" value={activite.id} />
            {/* Horodatage de l'affichage, pour le bonus de rapidité (lot 14). */}
            <input type="hidden" name="started_at" value={Date.now()} />
            <div className="space-y-6">
              {questions.map((q, i) => (
                <fieldset key={q.id}>
                  <legend className="mb-2 text-sm font-medium text-slate-900">
                    {i + 1}. {q.prompt}
                  </legend>
                  <div className="space-y-1.5">
                    {((q.options as string[]) ?? []).map((opt, j) => (
                      <label
                        key={j}
                        className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border border-slate-200 px-3 py-2.5 text-sm hover:bg-slate-50 has-checked:border-brand-400 has-checked:bg-brand-50"
                      >
                        <input
                          type="radio"
                          name={`q_${q.id}`}
                          value={j}
                          className="mt-0.5 h-5 w-5 shrink-0 accent-brand-600"
                        />
                        {opt}
                      </label>
                    ))}
                  </div>
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

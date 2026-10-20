import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/profile";
import { soumettreQcm } from "@/app/(app)/formations/actions";
import type { ResultatCorrection } from "@/lib/courses/progression";
import { ChampReponse, LigneFeedback } from "@/components/activites/ChampReponse";
import { ActiviteRedigee } from "@/components/activites/ActiviteRedigee";
import { estActiviteRedigee } from "@/lib/courses/activites-redigees";
import { AuthForm } from "@/components/ui/AuthForm";
import { Alert, Card, PageTitle } from "@/components/ui";

export const metadata: Metadata = { title: "Activité de session" };

/**
 * QCM passé pendant une session présentielle : accessible aux
 * participants de la session (sans inscription individuelle à la
 * formation). La tentative est rattachée à la session et visible
 * en direct par le formateur.
 */
export default async function ActiviteSessionPage({
  params,
}: {
  params: Promise<{ id: string; activiteId: string }>;
}) {
  const { id, activiteId } = await params;
  const user = await getCurrentUser();
  if (!user) redirect("/connexion");

  const supabase = await createClient();
  const { data: session } = await supabase
    .from("live_sessions")
    .select("id, title, status, course_id, current_activity_id")
    .eq("id", id)
    .maybeSingle();
  if (!session) notFound();

  const { data: presence } = await supabase
    .from("session_participants")
    .select("id")
    .eq("session_id", session.id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!presence) redirect("/rejoindre");

  const { data: activite } = await supabase
    .from("activities")
    .select("id, title, instructions, type, content, difficulty, activity_competencies(competency:competencies(name))")
    .eq("id", activiteId)
    .maybeSingle();
  if (!activite) notFound();
  const redigee = estActiviteRedigee(activite.type) ? activite.type : null;
  const competences = (activite.activity_competencies ?? [])
    .map((ac) => {
      const c = Array.isArray(ac.competency) ? ac.competency[0] : ac.competency;
      return c?.name;
    })
    .filter(Boolean) as string[];

  // IMPORTANT : pas de expected_answer ni explanation côté navigateur.
  const { data: questions } = await supabase
    .from("questions")
    .select("id, type, prompt, options, position")
    .eq("activity_id", activite.id)
    .order("position");

  const { data: derniereTentative } = await supabase
    .from("attempts")
    .select("id, score, feedback")
    .eq("activity_id", activite.id)
    .eq("user_id", user.id)
    .eq("session_id", session.id)
    .order("submitted_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const feedback = (derniereTentative?.feedback ?? null) as ResultatCorrection | null;

  const activiteActive =
    session.status === "open" && session.current_activity_id === activite.id;

  return (
    <div className="mx-auto max-w-2xl">
      <p className="mb-2 text-sm">
        <Link
          href={`/sessions/${session.id}/participer`}
          className="text-brand-600 hover:underline"
        >
          ← {session.title}
        </Link>
      </p>
      <PageTitle>{activite.title}</PageTitle>

      {redigee ? (
        <ActiviteRedigee
          type={redigee}
          instructions={activite.instructions}
          content={activite.content}
          difficulty={activite.difficulty}
          competences={competences}
        />
      ) : activite.instructions ? (
        <Card className="mb-6">
          <p className="text-sm text-slate-700">{activite.instructions}</p>
        </Card>
      ) : null}

      {derniereTentative && feedback ? (
        <Card className="mb-6 border-brand-200">
          <h2 className="font-semibold">
            {derniereTentative.score === null
              ? "Votre réponse : en attente de la note du formateur"
              : `Votre réponse : ${Number(derniereTentative.score)} % (${feedback.nbCorrectes}/${feedback.nbQuestions})`}
          </h2>
          <ul className="mt-3 space-y-2 text-sm">
            {feedback.details.map((d, i) => (
              <LigneFeedback key={d.questionId} detail={d} numero={i + 1} libelle={redigee ? "Votre réponse" : undefined} />
            ))}
          </ul>
          <p className="mt-3 text-sm text-slate-500">
            Réponse transmise au formateur — attendez le débriefing en salle.
          </p>
        </Card>
      ) : null}

      {!activiteActive ? (
        <Alert kind="info">
          {session.status === "closed"
            ? "La session est clôturée."
            : "Cette activité n'est pas (ou plus) en cours. Revenez à l'écran de session."}
        </Alert>
      ) : !questions || questions.length === 0 ? (
        <Alert kind="info">{redigee ? "Cette activité n'a pas encore de consigne." : "Ce QCM ne contient pas encore de question."}</Alert>
      ) : !derniereTentative ? (
        <Card>
          <AuthForm
            action={soumettreQcm}
            submitLabel="Envoyer ma réponse"
            pendingLabel="Envoi en cours…"
          >
            <input type="hidden" name="course_id" value={session.course_id ?? ""} />
            <input type="hidden" name="activity_id" value={activite.id} />
            <input type="hidden" name="session_id" value={session.id} />
            <input type="hidden" name="started_at" value={Date.now()} />
            <div className="space-y-6">
              {questions.map((q, i) => (
                <fieldset key={q.id}>
                  <legend className="mb-2 text-sm font-medium text-slate-900">
                    {redigee ? "Votre réponse" : `${i + 1}. ${q.prompt}`}
                  </legend>
                  <ChampReponse
                    question={q}
                    placeholder={redigee ? "Rédigez votre réponse ici. Elle est pré-corrigée par l'IA puis validée par le formateur." : undefined}
                  />
                </fieldset>
              ))}
            </div>
          </AuthForm>
        </Card>
      ) : null}
    </div>
  );
}

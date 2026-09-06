import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/profile";
import { soumettreQcm } from "@/app/(app)/formations/actions";
import type { ResultatCorrection } from "@/lib/courses/progression";
import { AuthForm } from "@/components/ui/AuthForm";
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

  const { data: inscription } = await supabase
    .from("enrollments")
    .select("id")
    .eq("course_id", formation.id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!inscription) redirect(`/catalogue/${formation.id}`);

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
    </div>
  );
}

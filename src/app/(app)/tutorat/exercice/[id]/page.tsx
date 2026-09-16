import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/profile";
import type { ResultatCorrection } from "@/lib/courses/progression";
import { TYPE_EXERCICE_LABELS, XP_EXERCICE, type TypeExercice } from "@/lib/tutorat/blocage";
import type { ContenuExercice } from "@/lib/tutorat/exercices";
import { repondreExercice } from "@/app/(app)/tutorat/actions";
import { AuthForm } from "@/components/ui/AuthForm";
import { Badge, Card, PageTitle, Retour } from "@/components/ui";

export const metadata: Metadata = { title: "Exercice personnalisé" };

/**
 * Passage d'un exercice personnalisé : même forme qu'un QCM. Le contenu
 * ne contient jamais la bonne réponse ; la correction vient du serveur.
 */
export default async function ExercicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) redirect("/connexion");

  const supabase = await createClient();
  const { data: e } = await supabase
    .from("personalized_exercises")
    .select("id, course_id, exercise_type, difficulty, content, status, score, feedback, completed_at, competency:competencies(name)")
    .eq("id", id)
    .maybeSingle();
  if (!e) notFound();

  const content = e.content as ContenuExercice;
  const competence = Array.isArray(e.competency) ? e.competency[0] : e.competency;
  const feedback = (e.feedback ?? null) as ResultatCorrection | null;
  const type = e.exercise_type as TypeExercice;

  return (
    <div className="mx-auto max-w-3xl">
      <Retour href={`/tutorat?formation=${e.course_id}`} />
      <PageTitle action={<Badge ton="or">{TYPE_EXERCICE_LABELS[type]}</Badge>}>{content.title}</PageTitle>
      <div className="-mt-4 mb-6 flex flex-wrap items-center gap-2 text-sm text-slate-500">
        <Badge>Difficulté {e.difficulty}/5</Badge>
        {competence?.name ? <Badge>{competence.name}</Badge> : null}
        <span>{XP_EXERCICE[type]} XP à partir de 80 %</span>
      </div>

      {content.instructions ? (
        <Card className="mb-6"><p className="text-sm text-slate-700">{content.instructions}</p></Card>
      ) : null}

      {e.status === "completed" && feedback ? (
        <Card className="mb-6 border-brand-200">
          <h2 className="font-semibold">
            Résultat : {Number(e.score)} % ({feedback.nbCorrectes}/{feedback.nbQuestions})
          </h2>
          <ul className="mt-3 space-y-3 text-sm">
            {content.questions.map((q, i) => {
              const d = feedback.details.find((x) => x.questionId === q.id);
              return (
                <li key={q.id} className={`rounded-lg px-3 py-2 ${d?.correcte ? "bg-green-50 text-green-900" : "bg-red-50 text-red-900"}`}>
                  <p className="font-medium">{i + 1}. {q.prompt}</p>
                  <p className="mt-1">
                    {d?.correcte ? "Correcte ✓" : "Incorrecte ✗"}
                    {d && d.bonneReponse >= 0 ? ` · bonne réponse : ${q.options[d.bonneReponse]}` : ""}
                    {d && d.reponseDonnee !== null && !d.correcte ? ` · votre réponse : ${q.options[d.reponseDonnee]}` : ""}
                  </p>
                  {d?.explication ? <p className="mt-1 text-slate-600">{d.explication}</p> : null}
                </li>
              );
            })}
          </ul>
        </Card>
      ) : (
        <Card>
          <AuthForm action={repondreExercice} submitLabel="Valider mes réponses" pendingLabel="Correction…">
            <input type="hidden" name="exercise_id" value={e.id} />
            <input type="hidden" name="started_at" value={Date.now()} />
            <div className="space-y-6">
              {content.questions.map((q, i) => (
                <fieldset key={q.id}>
                  <legend className="mb-2 text-sm font-medium text-slate-900">{i + 1}. {q.prompt}</legend>
                  <div className="space-y-1.5">
                    {q.options.map((opt, j) => (
                      <label key={j} className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border border-slate-200 px-3 py-2.5 text-sm hover:bg-slate-50 has-checked:border-brand-400 has-checked:bg-brand-50">
                        <input type="radio" name={`q_${q.id}`} value={j} className="mt-0.5 h-5 w-5 shrink-0 accent-brand-600" />
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

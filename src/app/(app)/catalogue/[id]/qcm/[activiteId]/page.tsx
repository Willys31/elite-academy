import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/profile";
import { isEliteAdmin } from "@/lib/auth/roles";
import {
  canCreateCourse,
  isContentEditable,
  STATUS_LABELS,
  type CourseStatus,
} from "@/lib/courses/statuts";
import {
  ajouterQuestion,
  supprimerQuestion,
} from "@/app/(app)/catalogue/actions";
import { AuthForm } from "@/components/ui/AuthForm";
import {
  Alert,
  Badge,
  Card,
  EmptyState,
  Input,
  Label,
  PageTitle,
  Select,
  Textarea,
} from "@/components/ui";

export const metadata: Metadata = { title: "Éditeur de QCM" };

/**
 * Éditeur de QCM : questions, options, bonne réponse, explication,
 * compétence évaluée et difficulté. Modifiable uniquement quand la
 * formation est en brouillon.
 */
export default async function EditeurQcmPage({
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
    .select("id, title, status, organization_id")
    .eq("id", id)
    .maybeSingle();
  if (!formation) notFound();

  const peutModifier =
    isEliteAdmin(user.memberships) ||
    canCreateCourse(user.memberships, formation.organization_id);
  if (!peutModifier) redirect(`/catalogue/${formation.id}`);

  const { data: activite } = await supabase
    .from("activities")
    .select("id, title, instructions, lesson_id, lesson:lessons(title)")
    .eq("id", activiteId)
    .maybeSingle();
  if (!activite) notFound();

  const [{ data: questions }, { data: competences }] = await Promise.all([
    supabase
      .from("questions")
      .select(
        "id, prompt, options, expected_answer, explanation, difficulty, position, competency:competencies(name)"
      )
      .eq("activity_id", activite.id)
      .order("position"),
    supabase.from("competencies").select("id, name, domain").order("name"),
  ]);

  const statut = formation.status as CourseStatus;
  const editable = isContentEditable(statut);
  const lecon = Array.isArray(activite.lesson) ? activite.lesson[0] : activite.lesson;

  return (
    <div className="mx-auto max-w-3xl">
      <p className="mb-2 text-sm">
        <Link
          href={`/catalogue/${formation.id}/modifier`}
          className="text-brand-600 hover:underline"
        >
          ← Éditeur de {formation.title}
        </Link>
      </p>
      <PageTitle>QCM — {activite.title}</PageTitle>
      <div className="-mt-4 mb-6 flex flex-wrap items-center gap-2 text-sm text-slate-500">
        <Badge>{STATUS_LABELS[statut]}</Badge>
        <span>Leçon : {lecon?.title}</span>
      </div>

      {!editable ? (
        <div className="mb-6">
          <Alert kind="info">
            Formation en statut « {STATUS_LABELS[statut]} » : les questions
            sont en lecture seule. Repassez la formation en brouillon pour
            modifier.
          </Alert>
        </div>
      ) : null}

      <section aria-label="Questions">
        {!questions || questions.length === 0 ? (
          <EmptyState
            title="Aucune question pour le moment"
            hint="Ajoutez la première question ci-dessous. Un bon QCM évite les ambiguïtés et les indices involontaires."
          />
        ) : (
          <div className="space-y-3">
            {questions.map((q, i) => {
              const comp = Array.isArray(q.competency) ? q.competency[0] : q.competency;
              const bonne = Number((q.expected_answer as { index?: number })?.index ?? -1);
              return (
                <Card key={q.id}>
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
                    <p className="min-w-0 font-medium">
                      {i + 1}. {q.prompt}
                    </p>
                    {editable ? (
                      <AuthForm
                        action={supprimerQuestion}
                        submitLabel="Supprimer"
                        pendingLabel="…"
                      >
                        <input type="hidden" name="course_id" value={formation.id} />
                        <input type="hidden" name="activity_id" value={activite.id} />
                        <input type="hidden" name="question_id" value={q.id} />
                      </AuthForm>
                    ) : null}
                  </div>
                  <ul className="mt-2 space-y-1 text-sm">
                    {((q.options as string[]) ?? []).map((opt, j) => (
                      <li
                        key={j}
                        className={`rounded px-2 py-1 ${
                          j === bonne
                            ? "bg-green-50 font-medium text-green-900"
                            : "text-slate-700"
                        }`}
                      >
                        {j === bonne ? "✓ " : "• "}
                        {opt}
                      </li>
                    ))}
                  </ul>
                  <p className="mt-2 text-xs text-slate-400">
                    {comp?.name ? `Compétence : ${comp.name} · ` : ""}
                    Difficulté {q.difficulty}/5
                    {q.explanation ? ` · Explication : ${q.explanation}` : ""}
                  </p>
                </Card>
              );
            })}
          </div>
        )}
      </section>

      {editable ? (
        <Card className="mt-6">
          <h2 className="mb-3 font-semibold">Nouvelle question</h2>
          <AuthForm
            action={ajouterQuestion}
            submitLabel="Ajouter la question"
            pendingLabel="Ajout…"
          >
            <input type="hidden" name="course_id" value={formation.id} />
            <input type="hidden" name="activity_id" value={activite.id} />
            <div>
              <Label htmlFor="prompt">Énoncé</Label>
              <Textarea id="prompt" name="prompt" rows={2} required />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {[0, 1, 2, 3].map((i) => (
                <div key={i}>
                  <Label htmlFor={`opt_${i}`}>
                    Option {i + 1}
                    {i < 2 ? " (obligatoire)" : " (facultatif)"}
                  </Label>
                  <Input id={`opt_${i}`} name={`opt_${i}`} required={i < 2} />
                </div>
              ))}
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <Label htmlFor="bonne">Bonne réponse</Label>
                <Select id="bonne" name="bonne" required defaultValue="0">
                  <option value="0">Option 1</option>
                  <option value="1">Option 2</option>
                  <option value="2">Option 3</option>
                  <option value="3">Option 4</option>
                </Select>
              </div>
              <div>
                <Label htmlFor="difficulty">Difficulté</Label>
                <Select id="difficulty" name="difficulty" defaultValue="1">
                  {[1, 2, 3, 4, 5].map((d) => (
                    <option key={d} value={d}>
                      {d}/5
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor="competency_id">Compétence évaluée</Label>
                <Select id="competency_id" name="competency_id" defaultValue="">
                  <option value="">— Aucune —</option>
                  {(competences ?? []).map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
            <div>
              <Label htmlFor="explanation">
                Explication (affichée après correction)
              </Label>
              <Textarea id="explanation" name="explanation" rows={2} />
            </div>
          </AuthForm>
        </Card>
      ) : null}
    </div>
  );
}

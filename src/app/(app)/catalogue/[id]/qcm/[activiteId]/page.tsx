import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth/profile";
import { isEliteAdmin } from "@/lib/auth/roles";
import {
  canCreateCourse,
  isContentEditable,
  STATUS_LABELS,
  type CourseStatus,
} from "@/lib/courses/statuts";
import {
  lireQuestion,
  lireTypeQuestion,
  OPTIONS_VRAI_FAUX,
  TYPE_QUESTION_AIDES,
  TYPE_QUESTION_LABELS,
  TYPES_QUESTION,
  type TypeQuestion,
} from "@/lib/courses/questions";
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
 * Éditeur de questions : QCM à choix unique, vrai/faux, réponse courte
 * et question ouverte (PRD §14, lot 23), avec explication, compétence
 * évaluée et difficulté. Modifiable uniquement quand la formation est
 * en brouillon.
 *
 * Le type de la nouvelle question se choisit par `?type=` : la page
 * reste un composant serveur, et le formulaire n'affiche que les
 * champs du type choisi.
 */
export default async function EditeurQcmPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; activiteId: string }>;
  searchParams: Promise<{ type?: string | string[] }>;
}) {
  const { id, activiteId } = await params;
  const typeChoisi = lireTypeQuestion((await searchParams).type);
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

  /* Les corrigés ne sont plus lisibles par les rôles applicatifs
     (migration 0019) : le concepteur, dont le droit d'édition vient
     d'être vérifié (`peutModifier`) et dont l'activité est visible par
     RLS, les lit via le client d'administration. */
  const [{ data: questions }, { data: competences }] = await Promise.all([
    createAdminClient()
      .from("questions")
      .select(
        "id, type, prompt, options, expected_answer, explanation, difficulty, position, competency_id, competency:competencies(name)"
      )
      .eq("activity_id", activite.id)
      .order("position"),
    supabase.from("competencies").select("id, name, domain").order("name"),
  ]);

  const statut = formation.status as CourseStatus;
  const editable = isContentEditable(statut);
  const lecon = Array.isArray(activite.lesson) ? activite.lesson[0] : activite.lesson;
  const baseHref = `/catalogue/${formation.id}/qcm/${activite.id}`;

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
            {questions.map((ligne, i) => {
              const q = lireQuestion(ligne);
              const comp = Array.isArray(ligne.competency) ? ligne.competency[0] : ligne.competency;
              return (
                <Card key={q.id}>
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
                    <div className="min-w-0">
                      <p className="font-medium">
                        {i + 1}. {q.prompt}
                      </p>
                      <p className="mt-1">
                        <Badge ton={q.type === "open" ? "or" : "neutre"}>
                          {TYPE_QUESTION_LABELS[q.type]}
                        </Badge>
                      </p>
                    </div>
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

                  {q.type === "qcm" || q.type === "true_false" ? (
                    <ul className="mt-2 space-y-1 text-sm">
                      {q.options.map((opt, j) => (
                        <li
                          key={j}
                          className={`rounded px-2 py-1 ${
                            j === q.bonneReponse
                              ? "bg-green-50 font-medium text-green-900"
                              : "text-slate-700"
                          }`}
                        >
                          {j === q.bonneReponse ? "✓ " : "• "}
                          {opt}
                        </li>
                      ))}
                    </ul>
                  ) : q.type === "short_answer" ? (
                    <p className="mt-2 rounded bg-green-50 px-2 py-1 text-sm text-green-900">
                      Réponses acceptées : {q.acceptees.join(" · ") || "—"}
                    </p>
                  ) : (
                    <p className="mt-2 rounded bg-sand-50 px-2 py-1 text-sm text-slate-700">
                      {q.grille
                        ? `Éléments attendus (vus du correcteur seulement) : ${q.grille}`
                        : "Sans grille : le correcteur jugera librement."}
                    </p>
                  )}

                  <p className="mt-2 text-xs text-slate-400">
                    {comp?.name ? `Compétence : ${comp.name} · ` : ""}
                    Difficulté {ligne.difficulty}/5
                    {q.explication ? ` · Explication : ${q.explication}` : ""}
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

          {/* Choix du type : de simples liens, le formulaire se recharge
              avec les champs du type (page serveur, sans JavaScript). */}
          <nav aria-label="Type de question" className="mb-4">
            <ul className="flex flex-wrap gap-1 rounded-xl border border-sand-200 bg-white p-1">
              {TYPES_QUESTION.map((t) => {
                const actif = t === typeChoisi;
                return (
                  <li key={t}>
                    <Link
                      href={t === "qcm" ? baseHref : `${baseHref}?type=${t}`}
                      aria-current={actif ? "page" : undefined}
                      className={`inline-flex min-h-10 items-center rounded-lg px-3 text-sm font-medium transition-colors duration-150 ${
                        actif
                          ? "bg-brand-50 text-brand-800"
                          : "text-slate-600 hover:bg-sand-100 hover:text-ink-900"
                      }`}
                    >
                      {TYPE_QUESTION_LABELS[t]}
                    </Link>
                  </li>
                );
              })}
            </ul>
            <p className="mt-2 text-xs leading-relaxed text-slate-500">
              {TYPE_QUESTION_AIDES[typeChoisi]}
            </p>
          </nav>

          <AuthForm
            key={typeChoisi}
            action={ajouterQuestion}
            submitLabel={`Ajouter la question (${TYPE_QUESTION_LABELS[typeChoisi]})`}
            pendingLabel="Ajout…"
          >
            <input type="hidden" name="course_id" value={formation.id} />
            <input type="hidden" name="activity_id" value={activite.id} />
            <input type="hidden" name="type" value={typeChoisi} />
            <div>
              <Label htmlFor="prompt">
                {typeChoisi === "true_false" ? "Affirmation" : "Énoncé"}
              </Label>
              <Textarea
                id="prompt"
                name="prompt"
                rows={typeChoisi === "open" ? 3 : 2}
                required
                placeholder={
                  typeChoisi === "true_false"
                    ? "Ex. : Un entretien de recadrage se prépare par écrit."
                    : typeChoisi === "short_answer"
                      ? "Ex. : Quel est le nom de la méthode en quatre étapes vue dans la leçon ?"
                      : typeChoisi === "open"
                        ? "Ex. : Décrivez comment vous aborderiez ce conflit, en justifiant vos choix."
                        : undefined
                }
              />
            </div>

            <ChampsDuType type={typeChoisi} />

            <div className="grid gap-3 sm:grid-cols-2">
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
                {typeChoisi === "open"
                  ? "Explication (affichée à l'apprenant une fois la question notée)"
                  : "Explication (affichée après correction)"}
              </Label>
              <Textarea id="explanation" name="explanation" rows={2} />
            </div>
          </AuthForm>
        </Card>
      ) : null}
    </div>
  );
}

/** Champs propres à chaque type : options et bonne réponse, réponses acceptées, grille. */
function ChampsDuType({ type }: { type: TypeQuestion }) {
  if (type === "qcm") {
    return (
      <>
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
        <div className="sm:max-w-xs">
          <Label htmlFor="bonne">Bonne réponse</Label>
          <Select id="bonne" name="bonne" required defaultValue="0">
            <option value="0">Option 1</option>
            <option value="1">Option 2</option>
            <option value="2">Option 3</option>
            <option value="3">Option 4</option>
          </Select>
        </div>
      </>
    );
  }

  if (type === "true_false") {
    /* Les deux options sont pré-remplies et fixes : ce qui change, c'est
       laquelle est juste. */
    return (
      <fieldset>
        <legend className="mb-1.5 block text-sm font-medium text-ink-900">
          L&apos;affirmation est…
        </legend>
        <div className="flex flex-wrap gap-2">
          {OPTIONS_VRAI_FAUX.map((opt, j) => (
            <label
              key={opt}
              className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-slate-200 px-4 text-sm hover:bg-slate-50 has-checked:border-brand-400 has-checked:bg-brand-50"
            >
              <input
                type="radio"
                name="bonne"
                value={j}
                defaultChecked={j === 0}
                className="h-5 w-5 accent-brand-600"
              />
              {opt === "Vrai" ? "Vraie" : "Fausse"}
            </label>
          ))}
        </div>
      </fieldset>
    );
  }

  if (type === "short_answer") {
    return (
      <div>
        <Label htmlFor="accepted">Réponses acceptées (une par ligne)</Label>
        <Textarea
          id="accepted"
          name="accepted"
          rows={3}
          required
          placeholder={"Ex. :\nméthode DESC\nDESC"}
        />
        <p className="mt-1 text-xs text-slate-500">
          La comparaison ignore majuscules, accents et espaces. La première
          ligne est la réponse montrée à l&apos;apprenant après correction.
        </p>
      </div>
    );
  }

  return (
    <div>
      <Label htmlFor="rubric">Éléments attendus (grille du correcteur, facultatif)</Label>
      <Textarea
        id="rubric"
        name="rubric"
        rows={3}
        placeholder="Ex. : nomme le conflit sans juger ; propose un temps d'écoute ; fixe une règle commune."
      />
      <p className="mt-1 text-xs text-slate-500">
        Visible du correcteur seulement, jamais de l&apos;apprenant. La
        question attendra la note d&apos;un formateur ou d&apos;un concepteur.
      </p>
    </div>
  );
}

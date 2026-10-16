import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth/profile";
import { encadreUneOrganisation } from "@/lib/auth/roles";
import type { ResultatCorrection } from "@/lib/courses/progression";
import {
  lireQuestion,
  STATUT_TENTATIVE_LABELS,
  TYPE_QUESTION_LABELS,
} from "@/lib/courses/questions";
import { noterTentative } from "@/app/(app)/resultats/actions";
import { AuthForm } from "@/components/ui/AuthForm";
import { Alert } from "@/components/ui";
import { EcranTitre, Etiquette, Panneau, Retour } from "@/components/app";

export const metadata: Metadata = { title: "Corriger une copie" };

/** Question lue par le correcteur : le corrigé, plus le nom de la compétence. */
type QuestionCorrecteur = ReturnType<typeof lireQuestion> & { competence: string | null };

/**
 * Correction d'une copie (lot 23). Le correcteur voit toute la copie :
 * les questions corrigées automatiquement (pour le contexte) et, pour
 * chaque question ouverte, la réponse de l'apprenant, la grille du
 * concepteur, puis un verdict « acquise / non acquise » et un
 * commentaire.
 *
 * Droits : la tentative est lue sous RLS (la sienne ou `oversees_activity`)
 * ; une copie à soi n'est pas corrigeable. Les corrigés (grille,
 * explication) ne sont lisibles que par le client d'administration,
 * une fois ce droit établi.
 */
export default async function CorrigerCopiePage({
  params,
}: {
  params: Promise<{ attemptId: string }>;
}) {
  const { attemptId } = await params;
  const user = await getCurrentUser();
  if (!user) redirect("/connexion");
  if (!encadreUneOrganisation(user.memberships)) redirect("/resultats/corrections");

  const supabase = await createClient();
  const { data: tentative } = await supabase
    .from("attempts")
    .select(
      "id, user_id, activity_id, status, score, feedback, submitted_at, graded_at, activity:activities(title, instructions)"
    )
    .eq("id", attemptId)
    .maybeSingle();
  if (!tentative || tentative.user_id === user.id) notFound();

  const feedback = tentative.feedback as ResultatCorrection | null;
  if (!feedback || !Array.isArray(feedback.details)) notFound();

  const activite = Array.isArray(tentative.activity) ? tentative.activity[0] : tentative.activity;
  const enAttente = tentative.status === "pending_review";

  const [{ data: profil }, { data: questionsBrutes }] = await Promise.all([
    supabase.from("profiles").select("full_name").eq("id", tentative.user_id).maybeSingle(),
    createAdminClient()
      .from("questions")
      .select("id, type, prompt, options, expected_answer, explanation, competency_id, position, competency:competencies(name)")
      .eq("activity_id", tentative.activity_id)
      .order("position"),
  ]);
  const questions = new Map(
    (questionsBrutes ?? []).map((q) => [
      q.id as string,
      {
        ...lireQuestion(q),
        competence: (Array.isArray(q.competency) ? q.competency[0] : q.competency)?.name ?? null,
      },
    ])
  );

  const nom = (profil?.full_name as string | null) || "Apprenant";
  const aNoter = feedback.details.filter((d) => d.type === "open" && d.correcte === null);
  const liste = <ListeQuestions feedback={feedback} questions={questions} enAttente={enAttente} />;

  return (
    <div className="mx-auto max-w-3xl">
      <Retour href="/resultats/corrections" />
      <EcranTitre
        eyebrow={activite?.title ?? "Activité"}
        intro={
          tentative.submitted_at
            ? `Copie remise le ${new Date(tentative.submitted_at as string).toLocaleString("fr-FR", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })}.`
            : undefined
        }
      >
        Copie de {nom}
      </EcranTitre>

      <div className="-mt-4 mb-6 flex flex-wrap items-center gap-2">
        <Etiquette ton={enAttente ? "or" : "succes"}>
          {STATUT_TENTATIVE_LABELS[tentative.status as string] ?? tentative.status}
        </Etiquette>
        {tentative.score !== null ? <Etiquette>{Number(tentative.score)} %</Etiquette> : null}
        {tentative.graded_at ? (
          <span className="text-xs text-slate-500">
            notée le {new Date(tentative.graded_at as string).toLocaleDateString("fr-FR", { day: "numeric", month: "long" })}
          </span>
        ) : null}
      </div>

      {activite?.instructions ? (
        <Panneau className="mb-6">
          <p className="text-sm text-slate-700">{activite.instructions}</p>
        </Panneau>
      ) : null}

      {!enAttente ? (
        <div className="mb-6">
          <Alert kind="info">Cette copie a déjà été notée : elle est affichée en lecture seule.</Alert>
        </div>
      ) : null}

      {/* Une copie déjà notée se lit sans formulaire : ni bouton, ni
          enregistrement refusé. */}
      {enAttente ? (
        <AuthForm
          action={noterTentative}
          submitLabel={aNoter.length > 1 ? `Enregistrer les ${aNoter.length} notes` : "Enregistrer la note"}
          pendingLabel="Enregistrement…"
        >
          <input type="hidden" name="attempt_id" value={tentative.id as string} />
          {liste}
        </AuthForm>
      ) : (
        liste
      )}
    </div>
  );
}

/** Les questions de la copie, avec la réponse, le corrigé et, pour une
 *  question ouverte encore à noter, le verdict et le commentaire. */
function ListeQuestions({
  feedback,
  questions,
  enAttente,
}: {
  feedback: ResultatCorrection;
  questions: Map<string, QuestionCorrecteur>;
  enAttente: boolean;
}) {
  return (
    <ol className="space-y-4">
      {feedback.details.map((d, i) => {
        const q = questions.get(d.questionId);
        const ouverte = d.type === "open";
        return (
          <li key={d.questionId}>
            <Panneau className={ouverte && d.correcte === null ? "border-gold-400/60" : ""}>
              <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                <p className="min-w-0 font-medium text-ink-900">
                  {i + 1}. {q?.prompt ?? "Question supprimée depuis la remise"}
                </p>
                <div className="flex shrink-0 items-center gap-2">
                  <Etiquette>{TYPE_QUESTION_LABELS[d.type]}</Etiquette>
                  {d.correcte === null ? (
                    <Etiquette ton="or">À noter</Etiquette>
                  ) : d.correcte ? (
                    <Etiquette ton="succes">Juste</Etiquette>
                  ) : (
                    <Etiquette ton="alerte">Fausse</Etiquette>
                  )}
                </div>
              </div>
              {q?.competence ? (
                <p className="mt-1 text-xs text-slate-500">Compétence : {q.competence}</p>
              ) : null}

              {/* Réponse de l'apprenant */}
              <div className="mt-3 rounded-lg bg-sand-50 px-3.5 py-2.5 text-sm">
                <p className="text-xs font-medium text-slate-500">Réponse de l&apos;apprenant</p>
                {d.reponseDonnee === null ? (
                  <p className="mt-0.5 italic text-slate-500">Sans réponse</p>
                ) : typeof d.reponseDonnee === "number" ? (
                  <p className="mt-0.5 text-ink-900">{q?.options[d.reponseDonnee] ?? `Option ${d.reponseDonnee + 1}`}</p>
                ) : (
                  <p className="mt-0.5 whitespace-pre-line leading-relaxed text-ink-900">{d.reponseDonnee}</p>
                )}
              </div>

              {/* Corrigé, pour le contexte du correcteur */}
              {!ouverte && q ? (
                <p className="mt-2 text-xs text-slate-500">
                  Attendu :{" "}
                  {d.type === "short_answer"
                    ? q.acceptees.join(" · ")
                    : (q.options[q.bonneReponse] ?? "—")}
                </p>
              ) : null}
              {ouverte && q?.grille ? (
                <p className="mt-2 border-l-2 border-brand-300 pl-3 text-sm text-slate-600">
                  <span className="text-xs font-medium text-slate-500">Éléments attendus (grille du concepteur)</span>
                  <br />
                  {q.grille}
                </p>
              ) : null}

              {/* Verdict et commentaire */}
              {ouverte && enAttente && d.correcte === null ? (
                <fieldset className="mt-4">
                  <legend className="mb-1.5 text-sm font-medium text-ink-900">Votre note</legend>
                  <div className="flex flex-wrap gap-2">
                    <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-slate-200 px-4 text-sm hover:bg-slate-50 has-checked:border-brand-400 has-checked:bg-brand-50">
                      <input type="radio" name={`note_${d.questionId}`} value="1" required className="h-5 w-5 accent-brand-600" />
                      Acquise
                    </label>
                    <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-slate-200 px-4 text-sm hover:bg-slate-50 has-checked:border-red-300 has-checked:bg-red-50">
                      <input type="radio" name={`note_${d.questionId}`} value="0" required className="h-5 w-5 accent-red-600" />
                      Non acquise
                    </label>
                  </div>
                  <label htmlFor={`commentaire_${d.questionId}`} className="mt-3 block text-sm font-medium text-ink-900">
                    Commentaire pour l&apos;apprenant (facultatif)
                  </label>
                  <textarea
                    id={`commentaire_${d.questionId}`}
                    name={`commentaire_${d.questionId}`}
                    rows={3}
                    maxLength={2000}
                    placeholder="Ce qui est juste, ce qui manque, par quoi continuer."
                    className="mt-1 block w-full rounded-lg border border-slate-200 bg-white px-3.5 py-2.5 text-sm leading-relaxed text-ink-900 outline-none transition duration-200 focus:border-brand-600 focus:ring-4 focus:ring-brand-600/15"
                  />
                </fieldset>
              ) : null}
              {d.commentaire ? (
                <p className="mt-3 rounded-lg bg-brand-50 px-3.5 py-2.5 text-sm text-brand-900">
                  <span className="text-xs font-medium text-brand-700/80">Commentaire laissé</span>
                  <br />
                  {d.commentaire}
                </p>
              ) : null}
            </Panneau>
          </li>
        );
      })}
    </ol>
  );
}

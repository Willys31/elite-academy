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
import { noterTentative, reviserTentative } from "@/app/(app)/resultats/actions";
import { estRevisable, libelleDecision, lireDecision } from "@/lib/courses/correction-auto";
import { AuthForm } from "@/components/ui/AuthForm";
import { Alert } from "@/components/ui";
import { EcranTitre, Etiquette, Panneau, Retour } from "@/components/app";
import { PropositionIa } from "@/components/activites/PropositionIa";
import { propositionVersNote, type PropositionsCopie } from "@/lib/ai/precorrection";
import {
  estActiviteRedigee,
  lireContenuActiviteRedigee,
  TYPE_ACTIVITE_REDIGEE_LABELS,
} from "@/lib/courses/activites-redigees";

export const metadata: Metadata = { title: "Corriger une copie" };

/** Question lue par le correcteur : le corrigé, plus le nom de la compétence. */
type QuestionCorrecteur = ReturnType<typeof lireQuestion> & { competence: string | null };

/**
 * Copie vue par l'encadrement (lot 23 ; lot 27 bis). Deux usages : noter
 * en repli une copie dont la correction automatique n'a pas abouti, ou
 * réviser une copie déjà notée automatiquement. Le correcteur voit toute
 * la copie : les questions à choix (pour le contexte) et, pour chaque
 * question ouverte, la réponse de l'apprenant, la grille du concepteur,
 * puis un verdict « acquise / non acquise » et un commentaire.
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
      "id, user_id, activity_id, status, score, feedback, submitted_at, graded_at, activity:activities(title, instructions, type, content)"
    )
    .eq("id", attemptId)
    .maybeSingle();
  if (!tentative || tentative.user_id === user.id) notFound();

  const feedback = tentative.feedback as ResultatCorrection | null;
  if (!feedback || !Array.isArray(feedback.details)) notFound();

  const activite = Array.isArray(tentative.activity) ? tentative.activity[0] : tentative.activity;
  const enAttente = tentative.status === "pending_review";
  // Lot 27 : une copie notée (automatiquement ou non) reste révisable
  // par l'encadrement tant qu'elle contient une réponse rédigée.
  const decision = lireDecision(tentative.feedback);
  const revisable = !enAttente && tentative.status === "graded" && estRevisable(feedback);

  const [{ data: profil }, { data: questionsBrutes }, { data: revue }] = await Promise.all([
    supabase.from("profiles").select("full_name").eq("id", tentative.user_id).maybeSingle(),
    createAdminClient()
      .from("questions")
      .select("id, type, prompt, options, expected_answer, explanation, competency_id, position, competency:competencies(name)")
      .eq("activity_id", tentative.activity_id)
      .order("position"),
    /* Proposition de l'IA (lot 26) : lue sous RLS (`oversees_attempt`),
       donc jamais par l'auteur de la copie. */
    supabase.from("attempt_ai_reviews").select("proposal, model_name, created_at").eq("attempt_id", attemptId).maybeSingle(),
  ]);
  const propositions = ((revue?.proposal ?? null) as PropositionsCopie | null) ?? {};
  const redigee = estActiviteRedigee(activite?.type) ? activite?.type : null;
  const contenuRedige = redigee ? lireContenuActiviteRedigee(activite?.content) : null;
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
  const proposees = aNoter.filter((d) => propositions[d.questionId]).length;
  const liste = (
    <ListeQuestions
      feedback={feedback}
      questions={questions}
      enAttente={enAttente}
      revision={revisable}
      propositions={propositions}
      redigee={Boolean(redigee)}
    />
  );

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

      {redigee && contenuRedige ? (
        <Panneau className="mb-6">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
            {TYPE_ACTIVITE_REDIGEE_LABELS[redigee]} — consigne donnée à l&apos;apprenant
          </p>
          <p className="mt-1 whitespace-pre-line text-sm text-slate-700">{activite?.instructions}</p>
          {contenuRedige.expected_outcome ? (
            <p className="mt-2 text-sm text-slate-700">
              <span className="font-medium">Résultat attendu : </span>
              {contenuRedige.expected_outcome}
            </p>
          ) : null}
          {contenuRedige.evaluation ? (
            <p className="mt-2 text-sm text-slate-700">
              <span className="font-medium">Critères d&apos;évaluation : </span>
              {contenuRedige.evaluation}
            </p>
          ) : null}
        </Panneau>
      ) : activite?.instructions ? (
        <Panneau className="mb-6">
          <p className="text-sm text-slate-700">{activite.instructions}</p>
        </Panneau>
      ) : null}

      {enAttente ? (
        <div className="mb-6">
          <Alert kind="info">
            La correction automatique de cette copie n&apos;a pas abouti ; elle sera relancée d&apos;elle-même quand l&apos;apprenant
            reviendra sur l&apos;activité.
            {proposees > 0
              ? ` Une correction a déjà été préparée pour ${proposees > 1 ? `${proposees} réponses` : "cette réponse"} : verdict et commentaire sont pré-remplis ci-dessous.`
              : ""}{" "}
            Vous pouvez aussi la noter vous-même dès maintenant : l&apos;apprenant ne voit que ce que vous enregistrez.
          </Alert>
        </div>
      ) : (
        <div className="mb-6">
          <Alert kind="info">
            {libelleDecision(decision)}
            {tentative.graded_at
              ? ` le ${new Date(tentative.graded_at as string).toLocaleDateString("fr-FR", { day: "numeric", month: "long" })}`
              : ""}
            .
            {revisable
              ? " Vous pouvez réviser le verdict et le commentaire ci-dessous : l'apprenant sera prévenu."
              : " Cette copie est affichée en lecture seule."}
          </Alert>
        </div>
      )}

      {/* Une copie déjà notée se lit sans formulaire : ni bouton, ni
          enregistrement refusé. */}
      {enAttente ? (
        <AuthForm
          action={noterTentative}
          submitLabel={
            proposees > 0 && proposees === aNoter.length
              ? aNoter.length > 1
                ? "Valider les propositions"
                : "Valider la proposition"
              : aNoter.length > 1
                ? `Enregistrer les ${aNoter.length} notes`
                : "Enregistrer la note"
          }
          pendingLabel="Enregistrement…"
        >
          <input type="hidden" name="attempt_id" value={tentative.id as string} />
          {proposees > 0 ? <input type="hidden" name="source" value="ia" /> : null}
          {liste}
        </AuthForm>
      ) : revisable ? (
        <AuthForm action={reviserTentative} submitLabel="Enregistrer la révision" pendingLabel="Enregistrement…">
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
  revision,
  propositions,
  redigee,
}: {
  feedback: ResultatCorrection;
  questions: Map<string, QuestionCorrecteur>;
  enAttente: boolean;
  /** Copie déjà notée, révisable : les verdicts actuels sont pré-cochés. */
  revision: boolean;
  propositions: PropositionsCopie;
  /** Activité rédigée : la consigne est déjà affichée en tête, pas de numérotation. */
  redigee: boolean;
}) {
  return (
    <ol className="space-y-4">
      {feedback.details.map((d, i) => {
        const q = questions.get(d.questionId);
        const ouverte = d.type === "open";
        const proposition = ouverte && (d.correcte === null || revision) ? propositions[d.questionId] : undefined;
        const preRempli = revision
          ? { acquise: d.correcte === true, commentaire: d.commentaire }
          : proposition
            ? propositionVersNote(proposition)
            : null;
        const cocheAcquise = revision ? d.correcte === true : preRempli !== null && proposition?.verdict === "acquise";
        const cocheNonAcquise = revision ? d.correcte === false : preRempli !== null && proposition?.verdict === "non_acquise";
        return (
          <li key={d.questionId}>
            <Panneau className={ouverte && d.correcte === null ? "border-gold-400/60" : ""}>
              <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                <p className="min-w-0 font-medium text-ink-900">
                  {redigee ? "Réponse rédigée" : `${i + 1}. ${q?.prompt ?? "Question supprimée depuis la remise"}`}
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

              {/* Correction automatique préparée (lot 26), pour le correcteur seulement */}
              {proposition ? <PropositionIa proposition={proposition} /> : null}

              {/* Verdict et commentaire */}
              {ouverte && ((enAttente && d.correcte === null) || revision) ? (
                <fieldset className="mt-4">
                  <legend className="mb-1.5 text-sm font-medium text-ink-900">
                    {revision ? "Votre révision (verdict et commentaire actuels pré-remplis)" : preRempli ? "Votre décision (pré-remplie par la proposition)" : "Votre note"}
                  </legend>
                  <div className="flex flex-wrap gap-2">
                    <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-slate-200 px-4 text-sm hover:bg-slate-50 has-checked:border-brand-400 has-checked:bg-brand-50">
                      <input
                        type="radio"
                        name={`note_${d.questionId}`}
                        value="1"
                        required
                        defaultChecked={cocheAcquise}
                        className="h-5 w-5 accent-brand-600"
                      />
                      Acquise
                    </label>
                    <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-slate-200 px-4 text-sm hover:bg-slate-50 has-checked:border-red-300 has-checked:bg-red-50">
                      <input
                        type="radio"
                        name={`note_${d.questionId}`}
                        value="0"
                        required
                        defaultChecked={cocheNonAcquise}
                        className="h-5 w-5 accent-red-600"
                      />
                      Non acquise
                    </label>
                  </div>
                  <label htmlFor={`commentaire_${d.questionId}`} className="mt-3 block text-sm font-medium text-ink-900">
                    Commentaire pour l&apos;apprenant (facultatif)
                  </label>
                  <textarea
                    id={`commentaire_${d.questionId}`}
                    name={`commentaire_${d.questionId}`}
                    rows={preRempli?.commentaire ? 6 : 3}
                    maxLength={2000}
                    defaultValue={preRempli?.commentaire ?? ""}
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

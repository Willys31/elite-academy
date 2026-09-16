"use client";

import { useActionState } from "react";
import { demanderAide } from "@/app/(app)/tutorat/actions";
import type { ActionState } from "@/app/(app)/catalogue/actions";
import { TYPE_AIDE_LABELS, TYPES_AIDE, type TypeAide } from "@/lib/tutorat/blocage";
import { CLASSES_CHAMP } from "@/components/ui";
import { Icone } from "@/components/icons";

/**
 * Boutons d'aide du tuteur IA (addendum Tutorat §3.1) : Reformuler,
 * Je ne comprends pas, Voir un indice, Voir un exemple, Explication
 * détaillée. Un seul formulaire, cinq boutons `formAction` avec la
 * valeur du type ; la réponse s'affiche dans une carte « Aide IA ».
 *
 * Placé HORS du formulaire du QCM (un formulaire ne s'imbrique pas) :
 * l'apprenant choisit la question qui le bloque dans une liste.
 */
export function BoutonsAide({
  activityId,
  questions,
  aUneTentative,
  restantes,
}: {
  activityId: string;
  questions: Array<{ id: string; prompt: string }>;
  aUneTentative: boolean;
  restantes: number;
}) {
  const [state, action, enCours] = useActionState<ActionState, FormData>(demanderAide, {});

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="activity_id" value={activityId} />
      <label className="block text-sm font-medium text-ink-900">
        Question qui vous bloque
        <select name="question_id" required className={`${CLASSES_CHAMP} mt-1.5`} defaultValue={questions[0]?.id ?? ""}>
          {questions.map((q, i) => (
            <option key={q.id} value={q.id}>
              {i + 1}. {q.prompt.length > 90 ? `${q.prompt.slice(0, 88)}…` : q.prompt}
            </option>
          ))}
        </select>
      </label>

      <div className="flex flex-wrap gap-2">
        {TYPES_AIDE.map((type: TypeAide) => {
          const bloque = type === "detailed_explanation" && !aUneTentative;
          return (
            <button
              key={type}
              type="submit"
              name="help_type"
              value={type}
              disabled={enCours || bloque || restantes <= 0}
              title={bloque ? "Disponible après une première tentative" : undefined}
              className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-sand-300 bg-white px-3 text-sm font-medium text-ink-900 transition-colors duration-150 hover:bg-sand-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {TYPE_AIDE_LABELS[type]}
            </button>
          );
        })}
      </div>
      <p className="text-xs text-slate-500">
        {restantes > 0 ? `${restantes} aide${restantes > 1 ? "s" : ""} restante${restantes > 1 ? "s" : ""} aujourd'hui.` : "Limite quotidienne atteinte : partagez votre blocage dans l'Entraide."}
        {!aUneTentative ? " L'explication détaillée s'ouvre après une première tentative." : ""}
      </p>

      {enCours ? (
        <p className="flex items-center gap-2 text-sm text-slate-500" role="status">
          <span aria-hidden className="inline-block size-3.5 animate-spin rounded-full border-2 border-slate-300 border-t-brand-700" />
          Le tuteur réfléchit…
        </p>
      ) : null}
      {state.error ? (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {state.error}
        </p>
      ) : null}
      {state.success ? (
        <div role="status" className="flex gap-3 rounded-xl border border-brand-200 bg-brand-50 p-4">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-brand-700 text-white">
            <Icone nom="robot" className="size-4" />
          </span>
          <div className="min-w-0">
            <p className="text-xs font-medium text-brand-800">Aide IA</p>
            <p className="mt-1 whitespace-pre-line text-sm leading-relaxed text-ink-900">{state.success}</p>
          </div>
        </div>
      ) : null}
    </form>
  );
}

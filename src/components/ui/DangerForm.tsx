"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import type { ActionState } from "@/app/(app)/catalogue/actions";
import { Alert } from "@/components/ui";

/**
 * Formulaire de suppression, en deux temps.
 *
 * Un premier clic n'envoie rien : il remplace le bouton par une
 * confirmation explicite accompagnée de « Annuler ». C'est préféré à
 * `window.confirm` — que Next.js n'affiche pas de façon fiable pendant
 * une action serveur, et que les navigateurs mobiles présentent hors
 * contexte — et à une boîte de dialogue modale, disproportionnée pour
 * un bouton de ligne de liste.
 *
 * L'état de confirmation se referme seul après 8 secondes : un bouton
 * rouge ne doit pas rester armé au milieu d'une page.
 */
export function DangerForm({
  action,
  label,
  confirmLabel,
  pendingLabel,
  question,
  children,
  bloc = false,
}: {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  /** Libellé au repos, ex. « Supprimer la formation ». */
  label: string;
  /** Libellé une fois armé, ex. « Confirmer la suppression ». */
  confirmLabel: string;
  pendingLabel: string;
  /** Rappel de ce qui va disparaître, affiché une fois armé. */
  question?: string;
  /** Champs cachés (identifiants) transmis à l'action. */
  children?: React.ReactNode;
  /** Boutons pleine largeur (colonne latérale) plutôt qu'en ligne. */
  bloc?: boolean;
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    action,
    {}
  );
  const [arme, setArme] = useState(false);
  const boutonRef = useRef<HTMLButtonElement>(null);

  // Le bouton armé se désarme seul, et une erreur renvoyée par le
  // serveur ramène au repos : la confirmation doit être redonnée.
  useEffect(() => {
    if (!arme) return;
    const t = setTimeout(() => setArme(false), 8000);
    return () => clearTimeout(t);
  }, [arme]);

  useEffect(() => {
    if (state.error) setArme(false);
  }, [state.error]);

  const largeur = bloc ? "w-full" : "";

  return (
    <div className="space-y-2">
      {state.error ? <Alert kind="error">{state.error}</Alert> : null}
      {state.success ? <Alert kind="success">{state.success}</Alert> : null}

      {!arme ? (
        <button
          type="button"
          ref={boutonRef}
          onClick={() => setArme(true)}
          className={`inline-flex min-h-11 items-center justify-center rounded-lg border border-red-300 bg-white px-4 py-2 text-sm font-medium text-red-700 shadow-sm transition hover:bg-red-50 ${largeur}`}
        >
          {label}
        </button>
      ) : (
        <div className="space-y-2">
          {question ? (
            <p className="text-sm font-medium text-red-800">{question}</p>
          ) : null}
          <form
            action={formAction}
            className={`flex flex-col gap-2 sm:flex-row ${bloc ? "sm:flex-col" : ""}`}
          >
            {children}
            <button
              type="submit"
              disabled={pending}
              className={`inline-flex min-h-11 items-center justify-center rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-300 disabled:cursor-not-allowed disabled:opacity-60 ${largeur}`}
            >
              {pending ? pendingLabel : confirmLabel}
            </button>
            <button
              type="button"
              onClick={() => {
                setArme(false);
                boutonRef.current?.focus();
              }}
              disabled={pending}
              className={`inline-flex min-h-11 items-center justify-center rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-60 ${largeur}`}
            >
              Annuler
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

"use client";

import { useActionState } from "react";
import type { AuthState } from "@/app/(auth)/actions";
import { Alert } from "@/components/ui";
import { GoldButton } from "@/components/public";

/**
 * Enveloppe générique d'un formulaire adossé à une action serveur :
 * gère l'état (erreur / succès / envoi en cours) sans dupliquer la
 * logique dans chaque page.
 *
 * Deux tons de bouton. `or` est l'action principale d'un écran — s'y
 * inscrire, se connecter, affecter. `sobre` est pour tout le reste :
 * une rangée de boutons or pour « Retirer » ferait passer le retrait
 * pour le geste attendu, alors que c'est l'exception.
 */
export function AuthForm({
  action,
  submitLabel,
  pendingLabel,
  ton = "or",
  children,
}: {
  action: (prev: AuthState, formData: FormData) => Promise<AuthState>;
  submitLabel: string;
  pendingLabel: string;
  ton?: "or" | "sobre";
  children: React.ReactNode;
}) {
  const [state, formAction, pending] = useActionState<AuthState, FormData>(
    action,
    {}
  );

  /* Le disque tournant remplace le texte figé : sans lui, un réseau
     lent donne l'impression que le clic n'a rien fait. */
  const contenu = pending ? (
    <>
      <span
        aria-hidden
        className={`mr-2 inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 ${
          ton === "or"
            ? "border-ink-950/30 border-t-ink-950"
            : "border-slate-300 border-t-slate-600"
        }`}
      />
      {pendingLabel}
    </>
  ) : (
    submitLabel
  );

  return (
    <form action={formAction} className="space-y-4">
      {state.error ? <Alert kind="error">{state.error}</Alert> : null}
      {state.success ? <Alert kind="success">{state.success}</Alert> : null}
      {children}
      {ton === "or" ? (
        <GoldButton type="submit" disabled={pending} className="w-full">
          {contenu}
        </GoldButton>
      ) : (
        <button
          type="submit"
          disabled={pending}
          className="inline-flex min-h-11 w-full items-center justify-center rounded-xl border border-sand-200 bg-white px-4 py-2.5 text-sm font-medium text-ink-900 transition duration-200 hover:border-slate-300 hover:bg-sand-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:ring-offset-2 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-55"
        >
          {contenu}
        </button>
      )}
    </form>
  );
}

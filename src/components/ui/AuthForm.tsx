"use client";

import { useActionState } from "react";
import type { AuthState } from "@/app/(auth)/actions";
import { Alert, BASE_BOUTON, BOUTON_SOBRE } from "@/components/ui";
import { GoldButton } from "@/components/public";

/**
 * Enveloppe générique d'un formulaire adossé à une action serveur :
 * gère l'état (erreur / succès / envoi en cours) sans dupliquer la
 * logique dans chaque page.
 *
 * Deux tons de bouton. `or` est l'action principale d'un écran — s'y
 * inscrire, se connecter, affecter. `sobre` est pour tout le reste :
 * une rangée de boutons pleins pour « Retirer » ferait passer le retrait
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
        className={`inline-block size-3.5 animate-spin rounded-full border-2 ${
          ton === "or" ? "border-white/35 border-t-white" : "border-slate-300 border-t-slate-600"
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
          className={`${BASE_BOUTON} ${BOUTON_SOBRE} w-full`}
        >
          {contenu}
        </button>
      )}
    </form>
  );
}

"use client";

import { useActionState } from "react";
import type { AuthState } from "@/app/(auth)/actions";
import { Alert } from "@/components/ui";
import { GoldButton } from "@/components/public";

/**
 * Enveloppe générique des formulaires d'authentification :
 * gère l'état (erreur / succès / envoi en cours) autour d'une
 * action serveur, sans dupliquer la logique dans chaque page.
 *
 * Le bouton porte la charte publique (or sur encre) : ce composant
 * ne sert que les quatre écrans d'authentification, les écrans
 * internes ne sont pas touchés.
 */
export function AuthForm({
  action,
  submitLabel,
  pendingLabel,
  children,
}: {
  action: (prev: AuthState, formData: FormData) => Promise<AuthState>;
  submitLabel: string;
  pendingLabel: string;
  children: React.ReactNode;
}) {
  const [state, formAction, pending] = useActionState<AuthState, FormData>(
    action,
    {}
  );

  return (
    <form action={formAction} className="space-y-4">
      {state.error ? <Alert kind="error">{state.error}</Alert> : null}
      {state.success ? <Alert kind="success">{state.success}</Alert> : null}
      {children}
      <GoldButton type="submit" disabled={pending} className="w-full">
        {pending ? (
          <>
            {/* Le disque tournant remplace le texte figé : sans lui, un
                réseau lent donne l'impression que le clic n'a rien fait. */}
            <span
              aria-hidden
              className="mr-2 inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-ink-950/30 border-t-ink-950"
            />
            {pendingLabel}
          </>
        ) : (
          submitLabel
        )}
      </GoldButton>
    </form>
  );
}

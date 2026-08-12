"use client";

import { useActionState } from "react";
import type { AuthState } from "@/app/(auth)/actions";
import { Alert, PrimaryButton } from "@/components/ui";

/**
 * Enveloppe générique des formulaires d'authentification :
 * gère l'état (erreur / succès / envoi en cours) autour d'une
 * action serveur, sans dupliquer la logique dans chaque page.
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
      <PrimaryButton type="submit" disabled={pending} className="w-full">
        {pending ? pendingLabel : submitLabel}
      </PrimaryButton>
    </form>
  );
}

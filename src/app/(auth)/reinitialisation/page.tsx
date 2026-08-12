import type { Metadata } from "next";
import { reinitialiserMotDePasse } from "@/app/(auth)/actions";
import { AuthForm } from "@/components/ui/AuthForm";
import { Card, Input, Label } from "@/components/ui";

export const metadata: Metadata = { title: "Nouveau mot de passe" };

export default function ReinitialisationPage() {
  return (
    <Card>
      <h1 className="mb-2 text-lg font-semibold">Définir un nouveau mot de passe</h1>
      <p className="mb-4 text-sm text-slate-600">
        Choisissez un nouveau mot de passe d&apos;au moins 8 caractères.
      </p>

      <AuthForm
        action={reinitialiserMotDePasse}
        submitLabel="Enregistrer le mot de passe"
        pendingLabel="Enregistrement…"
      >
        <div>
          <Label htmlFor="password">Nouveau mot de passe</Label>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            minLength={8}
            required
          />
        </div>
        <div>
          <Label htmlFor="confirm">Confirmer le mot de passe</Label>
          <Input
            id="confirm"
            name="confirm"
            type="password"
            autoComplete="new-password"
            minLength={8}
            required
          />
        </div>
      </AuthForm>
    </Card>
  );
}

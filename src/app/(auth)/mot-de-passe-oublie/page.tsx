import Link from "next/link";
import type { Metadata } from "next";
import { demanderReinitialisation } from "@/app/(auth)/actions";
import { AuthForm } from "@/components/ui/AuthForm";
import { Card, Input, Label } from "@/components/ui";

export const metadata: Metadata = { title: "Mot de passe oublié" };

export default function MotDePasseOubliePage() {
  return (
    <Card>
      <h1 className="mb-2 text-lg font-semibold">Mot de passe oublié</h1>
      <p className="mb-4 text-sm text-slate-600">
        Saisissez votre adresse e-mail : nous vous enverrons un lien pour
        définir un nouveau mot de passe.
      </p>

      <AuthForm
        action={demanderReinitialisation}
        submitLabel="Envoyer le lien"
        pendingLabel="Envoi en cours…"
      >
        <div>
          <Label htmlFor="email">Adresse e-mail</Label>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            placeholder="vous@exemple.com"
          />
        </div>
      </AuthForm>

      <p className="mt-4 text-sm text-slate-600">
        <Link href="/connexion" className="text-brand-600 hover:underline">
          Retour à la connexion
        </Link>
      </p>
    </Card>
  );
}

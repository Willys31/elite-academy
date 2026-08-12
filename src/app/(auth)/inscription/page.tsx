import Link from "next/link";
import type { Metadata } from "next";
import { sInscrire } from "@/app/(auth)/actions";
import { AuthForm } from "@/components/ui/AuthForm";
import { Card, Input, Label } from "@/components/ui";

export const metadata: Metadata = { title: "Créer un compte" };

export default function InscriptionPage() {
  return (
    <Card>
      <h1 className="mb-4 text-lg font-semibold">Créer un compte</h1>

      <AuthForm
        action={sInscrire}
        submitLabel="Créer mon compte"
        pendingLabel="Création en cours…"
      >
        <div>
          <Label htmlFor="full_name">Nom complet</Label>
          <Input
            id="full_name"
            name="full_name"
            type="text"
            autoComplete="name"
            required
            placeholder="Prénom et nom"
          />
        </div>
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
        <div>
          <Label htmlFor="password">Mot de passe (8 caractères minimum)</Label>
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

      <p className="mt-4 text-sm text-slate-600">
        Déjà un compte ?{" "}
        <Link href="/connexion" className="text-brand-600 hover:underline">
          Se connecter
        </Link>
      </p>
    </Card>
  );
}

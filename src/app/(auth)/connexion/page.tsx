import Link from "next/link";
import type { Metadata } from "next";
import { seConnecter } from "@/app/(auth)/actions";
import { AuthForm } from "@/components/ui/AuthForm";
import { Alert, Card, Input, Label } from "@/components/ui";

export const metadata: Metadata = { title: "Connexion" };

export default async function ConnexionPage({
  searchParams,
}: {
  searchParams: Promise<{ suivant?: string; erreur?: string }>;
}) {
  const params = await searchParams;

  return (
    <Card>
      <h1 className="mb-4 text-lg font-semibold">Connexion</h1>

      {params.erreur === "lien-invalide" ? (
        <div className="mb-4">
          <Alert kind="error">
            Le lien utilisé est invalide ou a expiré. Demandez un nouveau lien
            depuis « Mot de passe oublié ».
          </Alert>
        </div>
      ) : null}

      <AuthForm
        action={seConnecter}
        submitLabel="Se connecter"
        pendingLabel="Connexion en cours…"
      >
        <input type="hidden" name="suivant" value={params.suivant ?? ""} />
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
          <Label htmlFor="password">Mot de passe</Label>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
          />
        </div>
      </AuthForm>

      <div className="mt-4 flex flex-col gap-2 text-sm text-slate-600 sm:flex-row sm:justify-between">
        <Link href="/mot-de-passe-oublie" className="text-brand-600 hover:underline">
          Mot de passe oublié ?
        </Link>
        <Link href="/inscription" className="text-brand-600 hover:underline">
          Créer un compte
        </Link>
      </div>
    </Card>
  );
}

import type { Metadata } from "next";
import { seConnecter } from "@/app/(auth)/actions";
import { AuthForm } from "@/components/ui/AuthForm";
import { Alert } from "@/components/ui";
import {
  PaperCard,
  PublicHeading,
  PublicInput,
  PublicLabel,
  QuietLink,
} from "@/components/public";

export const metadata: Metadata = { title: "Connexion" };

export default async function ConnexionPage({
  searchParams,
}: {
  searchParams: Promise<{ suivant?: string; erreur?: string }>;
}) {
  const params = await searchParams;

  return (
    <PaperCard crowned>
      <PublicHeading eyebrow="Votre espace">Se connecter</PublicHeading>

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
          <PublicLabel htmlFor="email">Adresse e-mail</PublicLabel>
          <PublicInput
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            placeholder="vous@exemple.com"
          />
        </div>
        <div>
          {/* Le lien d'oubli vit dans le libellé du champ : c'est là que
              l'utilisateur bloqué le cherche, pas en bas de la carte. */}
          <PublicLabel htmlFor="password">Mot de passe</PublicLabel>
          <PublicInput
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
          />
          <p className="mt-1.5 text-right">
            <QuietLink href="/mot-de-passe-oublie" className="text-xs">
              Mot de passe oublié ?
            </QuietLink>
          </p>
        </div>
      </AuthForm>

      <p className="mt-6 border-t border-sand-200 pt-5 text-sm text-slate-600">
        Pas encore de compte ? <QuietLink href="/inscription">En créer un</QuietLink>
      </p>
    </PaperCard>
  );
}

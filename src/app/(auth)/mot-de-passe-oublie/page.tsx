import type { Metadata } from "next";
import { demanderReinitialisation } from "@/app/(auth)/actions";
import { AuthForm } from "@/components/ui/AuthForm";
import {
  PaperCard,
  PublicHeading,
  PublicInput,
  PublicLabel,
  QuietLink,
} from "@/components/public";

export const metadata: Metadata = { title: "Mot de passe oublié" };

export default function MotDePasseOubliePage() {
  return (
    <PaperCard crowned>
      <PublicHeading
        eyebrow="Récupération"
        intro="Saisissez votre adresse e-mail : nous vous enverrons un lien pour définir un nouveau mot de passe."
      >
        Mot de passe oublié
      </PublicHeading>

      <AuthForm
        action={demanderReinitialisation}
        submitLabel="Envoyer le lien"
        pendingLabel="Envoi en cours…"
      >
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
      </AuthForm>

      <p className="mt-6 border-t border-sand-200 pt-5 text-sm text-slate-600">
        Vous vous en souvenez ?{" "}
        <QuietLink href="/connexion">Retour à la connexion</QuietLink>
      </p>
    </PaperCard>
  );
}

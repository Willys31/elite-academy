import type { Metadata } from "next";
import { reinitialiserMotDePasse } from "@/app/(auth)/actions";
import { AuthForm } from "@/components/ui/AuthForm";
import {
  PaperCard,
  PublicHeading,
  PublicInput,
  PublicLabel,
} from "@/components/public";

export const metadata: Metadata = { title: "Nouveau mot de passe" };

export default function ReinitialisationPage() {
  return (
    <PaperCard crowned>
      <PublicHeading
        eyebrow="Sécurité"
        intro="Choisissez un nouveau mot de passe d'au moins 8 caractères."
      >
        Définir un nouveau mot de passe
      </PublicHeading>

      <AuthForm
        action={reinitialiserMotDePasse}
        submitLabel="Enregistrer le mot de passe"
        pendingLabel="Enregistrement…"
      >
        <div>
          <PublicLabel htmlFor="password" hint="8 caractères minimum">
            Nouveau mot de passe
          </PublicLabel>
          <PublicInput
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            minLength={8}
            required
          />
        </div>
        <div>
          <PublicLabel htmlFor="confirm">Confirmer le mot de passe</PublicLabel>
          <PublicInput
            id="confirm"
            name="confirm"
            type="password"
            autoComplete="new-password"
            minLength={8}
            required
          />
        </div>
      </AuthForm>
    </PaperCard>
  );
}

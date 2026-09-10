import type { Metadata } from "next";
import { sInscrire } from "@/app/(auth)/actions";
import { AuthForm } from "@/components/ui/AuthForm";
import {
  PaperCard,
  PublicHeading,
  PublicInput,
  PublicLabel,
  QuietLink,
} from "@/components/public";

export const metadata: Metadata = { title: "Créer un compte" };

export default function InscriptionPage() {
  return (
    <PaperCard crowned>
      <PublicHeading
        eyebrow="Gratuit"
        intro="Quelques secondes suffisent. Vous décrirez votre premier besoin de formation juste après."
      >
        Créer un compte
      </PublicHeading>

      <AuthForm
        action={sInscrire}
        submitLabel="Créer mon compte"
        pendingLabel="Création en cours…"
      >
        <div>
          <PublicLabel htmlFor="full_name">Nom complet</PublicLabel>
          <PublicInput
            id="full_name"
            name="full_name"
            type="text"
            autoComplete="name"
            required
            placeholder="Prénom et nom"
          />
        </div>
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
          {/* La contrainte passe en indication à droite du libellé : elle
              reste lue par les lecteurs d'écran (elle est dans le <label>)
              sans allonger le libellé lui-même. */}
          <PublicLabel htmlFor="password" hint="8 caractères minimum">
            Mot de passe
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

      <p className="mt-6 border-t border-sand-200 pt-5 text-sm text-slate-600">
        Déjà un compte ? <QuietLink href="/connexion">Se connecter</QuietLink>
      </p>
    </PaperCard>
  );
}

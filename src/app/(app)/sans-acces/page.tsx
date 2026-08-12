import type { Metadata } from "next";
import { Card, SecondaryLink } from "@/components/ui";

export const metadata: Metadata = { title: "Accès non autorisé" };

export default function SansAccesPage() {
  return (
    <div className="mx-auto max-w-md pt-10">
      <Card className="text-center">
        <h1 className="text-lg font-semibold">Accès non autorisé</h1>
        <p className="mt-2 text-sm text-slate-600">
          Vous n&apos;avez pas les droits nécessaires pour consulter cette page.
          Si vous pensez qu&apos;il s&apos;agit d&apos;une erreur, contactez votre
          responsable d&apos;organisation ou Elite Experience.
        </p>
        <div className="mt-4">
          <SecondaryLink href="/accueil">Retour à l&apos;accueil</SecondaryLink>
        </div>
      </Card>
    </div>
  );
}

import type { Metadata } from "next";
import { Card, SecondaryLink } from "@/components/ui";

export const metadata: Metadata = { title: "Écran à venir" };

/**
 * Page générique pour les écrans prévus par la spécification UX/UI
 * mais livrés dans des lots ultérieurs (catalogue, formations,
 * sessions, révision, certificats, rapports…).
 * Elle évite les erreurs 404 sans simuler de fonctionnalité.
 */
export default function EcranAVenirPage() {
  return (
    <div className="mx-auto max-w-md pt-10">
      <Card className="text-center">
        <h1 className="text-lg font-semibold">Écran en préparation</h1>
        <p className="mt-2 text-sm text-slate-600">
          Cette fonctionnalité fait partie d&apos;un prochain lot de
          développement d&apos;Elite Academy. Elle sera activée après
          validation, conformément au plan de développement progressif.
        </p>
        <div className="mt-4">
          <SecondaryLink href="/accueil">Retour à l&apos;accueil</SecondaryLink>
        </div>
      </Card>
    </div>
  );
}

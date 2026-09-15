import Link from "next/link";
import type { ReactNode } from "react";
import { BrandPanel } from "@/components/public";
import { Icone } from "@/components/icons";
import { Marque } from "@/components/Marque";

/**
 * Écrans d'authentification, en deux colonnes à partir de `lg` :
 * le panneau vert porte l'argument et un aperçu du produit, la colonne
 * blanche porte le formulaire.
 *
 * Sous `lg`, le panneau disparaît entièrement. Un téléphone doit
 * conduire au champ de saisie en un coup d'œil : y empiler un
 * argumentaire ne ferait qu'allonger la page avant le premier champ.
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh bg-white lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <BrandPanel
        titre="La formation professionnelle qui se prouve."
        argument="Concevez des parcours dans tous les domaines, animez-les en ligne comme en salle, et concluez par un certificat que n'importe qui peut vérifier."
        preuves={[
          "Quatre niveaux de maîtrise, mesurés compétence par compétence",
          "Ateliers présentiels sans papier : un code, un QR, des résultats en direct",
          "Aucun contenu publié sans validation humaine",
        ]}
      />

      <div className="flex min-h-dvh flex-col px-4 py-4 sm:px-8 sm:py-6">
        <div className="flex items-center justify-between gap-3">
          {/* Marque visible uniquement quand le panneau vert est masqué,
              pour ne pas répéter deux fois le nom sur grand écran. */}
          <Link href="/" className="rounded-lg lg:invisible">
            <Marque />
          </Link>
          <Link
            href="/"
            className="inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2.5 text-sm font-medium text-slate-500 transition-colors duration-150 hover:bg-sand-100 hover:text-ink-900"
          >
            <Icone nom="flecheGauche" className="size-4" />
            Accueil
          </Link>
        </div>

        <main className="flex flex-1 items-center justify-center py-10">
          <div className="w-full max-w-[24rem]">{children}</div>
        </main>

        <p className="text-center text-xs text-slate-400">
          Elite Experience · Abidjan, Côte d&apos;Ivoire
        </p>
      </div>
    </div>
  );
}

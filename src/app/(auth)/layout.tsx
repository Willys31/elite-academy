import Link from "next/link";
import type { ReactNode } from "react";
import { BrandMark, BrandPanel } from "@/components/public";

/**
 * Écrans d'authentification, en deux colonnes à partir de `lg` :
 * l'encre porte l'argument de marque, le papier porte le formulaire.
 *
 * Sous `lg`, le panneau disparaît entièrement. Un téléphone doit
 * conduire au champ de saisie en un coup d'œil : y empiler un
 * argumentaire ne ferait qu'allonger la page avant le premier champ.
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh bg-sand-50 lg:grid lg:min-h-dvh lg:grid-cols-[1.05fr_1fr]">
      <BrandPanel
        titre={
          <>
            Le savoir se transmet.
            <br />
            La compétence,{" "}
            <em className="font-display italic text-gold-300">elle se prouve.</em>
          </>
        }
        argument="Concevez des parcours dans tous les domaines, animez-les en ligne comme en salle, et concluez par un certificat que n'importe qui peut vérifier."
        preuves={[
          "Quatre niveaux de maîtrise, mesurés compétence par compétence",
          "Ateliers présentiels sans papier : un code, un QR, des résultats en direct",
          "Aucun contenu publié sans validation humaine",
        ]}
      />

      <main className="relative flex min-h-dvh items-center justify-center px-4 py-10 sm:px-6 sm:py-12">
        <div className="w-full max-w-[26rem]">
          {/* Marque visible uniquement quand le panneau encre est masqué,
              pour ne pas répéter deux fois le nom sur grand écran. */}
          <div className="mb-7 lg:hidden">
            <BrandMark sous="La plateforme de formation d'Elite Experience" />
          </div>

          {children}

          {/* Entre 768 et 1024 px, le panneau encre ne tient pas à côté du
              formulaire, mais laisser la page entièrement vide autour de la
              carte gâcherait l'espace. L'argument y passe donc en une rangée
              compacte, sous la carte. */}
          <ul className="mt-7 hidden flex-wrap justify-center gap-x-5 gap-y-2 text-xs text-slate-500 md:flex lg:hidden">
            {[
              "Quatre niveaux de maîtrise",
              "En ligne et en salle",
              "Certificats vérifiables",
            ].map((preuve) => (
              <li key={preuve} className="flex items-center gap-1.5">
                <span aria-hidden className="text-gold-500">
                  ◆
                </span>
                {preuve}
              </li>
            ))}
          </ul>

          <p className="mt-7 text-center text-sm">
            <Link
              href="/"
              className="inline-flex items-center gap-1.5 rounded text-slate-500 transition duration-200 hover:text-ink-900"
            >
              <span aria-hidden>←</span> Retour à l&apos;accueil
            </Link>
          </p>
        </div>
      </main>
    </div>
  );
}

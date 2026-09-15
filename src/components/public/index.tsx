/**
 * Composants des écrans PUBLICS (authentification, vérification).
 *
 * Même matière que l'application connectée — un apprenant qui se
 * connecte ne doit pas changer de produit — avec un peu plus d'air.
 *
 * Règles conservées de `@/components/ui` :
 * - cible tactile d'au moins 44 px (`min-h-11`) ;
 * - champs à 16 px sous `sm` pour éviter le zoom automatique d'iOS.
 */

import Link from "next/link";
import type { ReactNode } from "react";
import { BASE_BOUTON, BOUTON_PRINCIPAL, CLASSES_CHAMP } from "@/components/ui";
import { Icone } from "@/components/icons";
import { Marque } from "@/components/Marque";

/* ------------------------------------------------------------------
   Surfaces
   ------------------------------------------------------------------ */

/**
 * Conteneur des formulaires publics. Posé directement sur la colonne
 * blanche des écrans d'authentification : une carte dans une colonne
 * déjà vide n'ajouterait qu'un cadre de plus.
 * `crowned` est conservé pour compatibilité et n'a plus d'effet.
 */
export function PaperCard({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
  crowned?: boolean;
}) {
  return <div className={className}>{children}</div>;
}

/** Titre d'écran public. */
export function PublicHeading({
  eyebrow,
  children,
  intro,
}: {
  eyebrow?: string;
  children: ReactNode;
  intro?: ReactNode;
}) {
  return (
    <div className="mb-7">
      {eyebrow ? <p className="text-sm font-medium text-brand-700">{eyebrow}</p> : null}
      <h1 className="mt-1.5 text-[1.75rem] font-semibold leading-tight tracking-[-0.03em] text-ink-950">
        {children}
      </h1>
      {intro ? (
        <p className="mt-2 text-[15px] leading-relaxed text-slate-600">{intro}</p>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------
   Champs de saisie
   ------------------------------------------------------------------ */

export function PublicLabel({
  htmlFor,
  children,
  hint,
}: {
  htmlFor: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label htmlFor={htmlFor} className="mb-1.5 flex items-baseline justify-between gap-3">
      <span className="text-sm font-medium text-ink-900">{children}</span>
      {hint ? <span className="text-xs text-slate-500">{hint}</span> : null}
    </label>
  );
}

export function PublicInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${CLASSES_CHAMP} ${props.className ?? ""}`} />;
}

/** Bouton principal public. Le nom date de l'ancienne charte. */
export function GoldButton({
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button {...props} className={`${BASE_BOUTON} ${BOUTON_PRINCIPAL} ${className}`} />
  );
}

/** Lien discret des bas de formulaire (« Mot de passe oublié ? », « Se connecter »). */
export function QuietLink({
  href,
  children,
  className = "",
}: {
  href: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={`inline-flex items-center gap-1 rounded-sm text-sm font-medium text-brand-700 underline-offset-4 transition-colors duration-150 hover:text-brand-800 hover:underline ${className}`}
    >
      {children}
    </Link>
  );
}

/* ------------------------------------------------------------------
   Panneau de marque (colonne gauche des écrans d'authentification)
   ------------------------------------------------------------------ */

/** Aperçu du produit : trois compétences d'un parcours, à trois niveaux. */
const APERCU = [
  { nom: "Communication en situation tendue", palier: "Avancé", rang: 3 },
  { nom: "Cadrage d'un désaccord", palier: "Opérationnel", rang: 2 },
  { nom: "Transmission des acquis", palier: "Elite", rang: 4 },
];

/**
 * Panneau vert affiché à côté des formulaires à partir de `lg`.
 * En dessous, il disparaît : sur un téléphone, l'écran doit conduire au
 * champ de saisie, pas faire lire un argumentaire.
 *
 * Plutôt qu'un décor, il montre un morceau du produit — une fiche de
 * compétences, coupée par le bas du panneau comme un écran qu'on
 * entrevoit.
 */
export function BrandPanel({
  titre,
  argument,
  preuves,
}: {
  titre: ReactNode;
  argument: string;
  preuves: string[];
}) {
  return (
    <aside className="relative hidden overflow-hidden bg-brand-900 text-white lg:flex lg:flex-col">
      <div className="px-12 pt-10">
        <Link
          href="/"
          className="inline-flex rounded-lg transition-opacity duration-150 hover:opacity-85"
        >
          <Marque clair />
        </Link>
      </div>

      <div className="px-12 pt-16 xl:pt-20">
        <h2 className="max-w-md text-[2.25rem] font-semibold leading-[1.1] tracking-[-0.035em]">
          {titre}
        </h2>
        <p className="mt-5 max-w-md text-[15px] leading-relaxed text-white/70">{argument}</p>
        <ul className="mt-8 space-y-3">
          {preuves.map((preuve) => (
            <li key={preuve} className="flex gap-3 text-sm text-white/85">
              <Icone nom="coche" className="mt-0.5 size-4 shrink-0 text-brand-300" epaisseur={2.25} />
              {preuve}
            </li>
          ))}
        </ul>
      </div>

      <div aria-hidden className="mt-auto px-12 pt-12">
        <div className="translate-y-6 rounded-t-xl bg-white p-5 text-ink-900 shadow-[0_-20px_60px_-20px_rgba(0,0,0,0.45)]">
          <div className="flex items-center justify-between gap-3 border-b border-sand-200 pb-3">
            <p className="text-sm font-semibold">Gestion des conflits en équipe</p>
            <span className="rounded-md bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700 ring-1 ring-inset ring-brand-200">
              En cours
            </span>
          </div>
          <ul className="mt-3 divide-y divide-sand-100">
            {APERCU.map((c) => (
              <li key={c.nom} className="flex items-center justify-between gap-4 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-sm">{c.nom}</p>
                  <p className="text-xs text-slate-500">{c.palier}</p>
                </div>
                <span className="flex shrink-0 gap-1">
                  {[1, 2, 3, 4].map((cran) => (
                    <span
                      key={cran}
                      className={`h-2 w-5 rounded-[3px] ${
                        cran <= c.rang
                          ? cran === 4
                            ? "bg-gold-500"
                            : "bg-brand-600"
                          : "bg-sand-200"
                      }`}
                    />
                  ))}
                </span>
              </li>
            ))}
          </ul>
          <div className="h-8" />
        </div>
      </div>
    </aside>
  );
}

/* ------------------------------------------------------------------
   Marque compacte (en tête des écrans publics sur mobile)
   ------------------------------------------------------------------ */

export function BrandMark({ sous }: { sous?: string }) {
  return (
    <div>
      <Link
        href="/"
        className="inline-flex rounded-lg transition-opacity duration-150 hover:opacity-80"
      >
        <Marque />
      </Link>
      {sous ? <p className="mt-2 text-sm text-slate-500">{sous}</p> : null}
    </div>
  );
}

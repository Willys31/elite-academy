/**
 * Composants des écrans PUBLICS (accueil, authentification, vérification).
 *
 * Pourquoi un jeu de composants distinct de `@/components/ui` :
 * les primitives partagées habillent une trentaine d'écrans internes déjà
 * validés. Les faire basculer sur la charte encre/or reviendrait à modifier
 * ces écrans sans les relire. Les composants ci-dessous appliquent donc la
 * charte publique sans toucher à l'application connectée ; ils pourront
 * remplacer les primitives internes quand cette partie sera reprise.
 *
 * Règles conservées de `@/components/ui` :
 * - cible tactile d'au moins 44 px (`min-h-11`) ;
 * - champs à 16 px sous `sm` pour éviter le zoom automatique d'iOS.
 */

import Link from "next/link";
import type { ReactNode } from "react";

/* ------------------------------------------------------------------
   Surfaces
   ------------------------------------------------------------------ */

/**
 * Carte « papier » : surface claire posée sur l'encre ou sur le sable.
 * Le liseré or en tête signe la marque sans alourdir la carte.
 */
export function PaperCard({
  children,
  className = "",
  crowned = false,
}: {
  children: ReactNode;
  className?: string;
  crowned?: boolean;
}) {
  return (
    <div
      className={`relative overflow-hidden rounded-2xl border border-sand-200 bg-white p-5 shadow-[0_1px_2px_rgba(12,16,43,0.04),0_12px_32px_-12px_rgba(12,16,43,0.16)] sm:p-7 ${className}`}
    >
      {crowned ? (
        <span
          aria-hidden
          className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-gold-400 to-transparent"
        />
      ) : null}
      {children}
    </div>
  );
}

/**
 * Titre d'écran public. Fraunces porte la voix de la marque ; le
 * sur-titre en petites capitales situe l'écran sans ajouter de niveau
 * de titre dans l'arbre d'accessibilité.
 */
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
    <div className="mb-6">
      {eyebrow ? (
        <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-gold-600">
          {eyebrow}
        </p>
      ) : null}
      <h1 className="mt-2 font-display text-2xl font-semibold tracking-tight text-ink-900 sm:text-[1.75rem]">
        {children}
      </h1>
      {intro ? (
        <p className="mt-2 text-sm leading-relaxed text-slate-600">{intro}</p>
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
      {hint ? <span className="text-xs text-slate-400">{hint}</span> : null}
    </label>
  );
}

/**
 * Champ public. L'anneau de mise au point est or : c'est le seul endroit
 * de l'interface où la couleur d'accent signale « c'est ici que vous êtes »,
 * et il reste visible sur fond blanc comme sur fond sable.
 */
const champPublic =
  "block min-h-11 w-full rounded-xl border border-sand-200 bg-sand-50/60 px-3.5 py-2.5 text-base text-ink-900 " +
  "placeholder:text-slate-400 outline-none transition duration-200 " +
  "hover:border-sand-200 hover:bg-white " +
  "focus:border-gold-400 focus:bg-white focus:ring-4 focus:ring-gold-300/25 sm:text-sm";

export function PublicInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${champPublic} ${props.className ?? ""}`} />;
}

/**
 * Bouton principal public : or sur encre, la couleur de la certification.
 * Le léger retrait au clic (`active:translate-y-px`) donne au bouton une
 * réponse physique — c'est ce qui manquait le plus à ces écrans.
 */
export function GoldButton({
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={`inline-flex min-h-11 items-center justify-center rounded-xl bg-gold-400 px-5 py-2.5 text-sm font-semibold text-ink-950 shadow-[0_6px_18px_-6px_rgba(211,160,50,0.6)] transition duration-200 hover:bg-gold-300 hover:shadow-[0_10px_24px_-8px_rgba(211,160,50,0.7)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-gold-300/40 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-55 disabled:shadow-none ${className}`}
    />
  );
}

/** Lien discret des bas de carte (« Mot de passe oublié ? », « Se connecter »). */
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
      className={`inline-flex items-center gap-1 rounded text-sm font-medium text-brand-700 underline-offset-4 transition duration-200 hover:text-gold-600 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-300 ${className}`}
    >
      {children}
    </Link>
  );
}

/* ------------------------------------------------------------------
   Panneau de marque (colonne gauche des écrans d'authentification)
   ------------------------------------------------------------------ */

/**
 * Panneau encre affiché à côté des formulaires à partir de `lg`.
 * En dessous, il disparaît : sur un téléphone, l'écran doit conduire au
 * champ de saisie, pas faire lire un argumentaire.
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
    <aside className="relative hidden overflow-hidden bg-ink-950 lg:flex lg:flex-col lg:justify-between">
      <div
        aria-hidden
        className="pointer-events-none absolute -top-32 left-[-20%] h-[440px] w-[440px] rounded-full bg-brand-700/30 blur-3xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute bottom-[-25%] right-[-15%] h-[380px] w-[380px] rounded-full bg-gold-500/10 blur-3xl"
      />

      <div className="relative px-12 pt-12">
        <Link href="/" className="inline-flex items-baseline gap-2.5">
          <span className="font-display text-xl font-semibold tracking-tight text-white">
            Elite Academy
          </span>
          <span className="text-[10px] uppercase tracking-[0.2em] text-white/40">
            par Elite Experience
          </span>
        </Link>
      </div>

      <div className="relative px-12 py-12">
        <h2 className="max-w-md font-display text-[2.1rem] font-semibold leading-[1.15] tracking-tight text-white">
          {titre}
        </h2>
        <p className="mt-5 max-w-sm text-[15px] leading-relaxed text-white/60">
          {argument}
        </p>
        <ul className="mt-9 space-y-3.5">
          {preuves.map((preuve) => (
            <li key={preuve} className="flex gap-3 text-sm text-white/75">
              <span aria-hidden className="mt-[3px] shrink-0 text-gold-400">
                ◆
              </span>
              {preuve}
            </li>
          ))}
        </ul>
      </div>

      <div className="relative border-t border-white/10 px-12 py-6">
        <p className="text-xs text-white/35">
          Abidjan, Côte d&apos;Ivoire · Formation professionnelle multi-domaines
        </p>
      </div>
    </aside>
  );
}

/* ------------------------------------------------------------------
   Marque compacte (en tête des écrans publics sur mobile)
   ------------------------------------------------------------------ */

export function BrandMark({ sous }: { sous?: string }) {
  return (
    <div className="text-center">
      <Link
        href="/"
        className="inline-flex items-baseline gap-2 rounded transition duration-200 hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-300"
      >
        <span className="font-display text-2xl font-semibold tracking-tight text-ink-900">
          Elite Academy
        </span>
      </Link>
      {sous ? <p className="mt-1.5 text-sm text-slate-500">{sous}</p> : null}
    </div>
  );
}

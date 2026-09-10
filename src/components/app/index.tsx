/**
 * Composants des écrans CONNECTÉS, sur la charte encre / papier / or.
 *
 * Comme `@/components/public`, ce jeu est distinct de `@/components/ui` :
 * les primitives partagées habillent encore les écrans concepteur,
 * formateur et administrateur, qui n'ont pas été relus. Les écrans de
 * l'apprenant utilisent les composants ci-dessous ; les autres suivront
 * quand leur tour viendra, sans rupture pour l'utilisateur puisque le
 * cadre (barre latérale, tiroir) est déjà commun.
 *
 * Règles conservées : cible tactile d'au moins 44 px, champs à 16 px sous
 * `sm` (pas de zoom iOS), rangées qui se replient plutôt que de comprimer.
 */

import Link from "next/link";
import type { ReactNode } from "react";

/* ------------------------------------------------------------------
   En-têtes
   ------------------------------------------------------------------ */

/**
 * En-tête d'écran : sur-titre discret, titre en Fraunces, phrase de
 * cadrage, actions à droite. La phrase n'est pas décorative — elle dit
 * ce que l'écran mesure ou permet, ce qui évite une page d'aide.
 */
export function EcranTitre({
  eyebrow,
  children,
  intro,
  action,
}: {
  eyebrow?: string;
  children: ReactNode;
  intro?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <header className="mb-7 flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
      <div className="min-w-0">
        {eyebrow ? (
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-gold-600">
            {eyebrow}
          </p>
        ) : null}
        <h1 className="mt-1.5 font-display text-2xl font-semibold tracking-tight text-ink-900 sm:text-[1.75rem]">
          {children}
        </h1>
        {intro ? (
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-600">
            {intro}
          </p>
        ) : null}
      </div>
      {action ? <div className="flex shrink-0 flex-wrap gap-2">{action}</div> : null}
    </header>
  );
}

/** Titre de section à l'intérieur d'un écran. */
export function SectionTitre({
  children,
  compte,
  action,
}: {
  children: ReactNode;
  compte?: number;
  action?: ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
      <h2 className="font-display text-lg font-semibold tracking-tight text-ink-900">
        {children}
        {compte !== undefined ? (
          <span className="ml-2 text-sm font-normal text-slate-400">{compte}</span>
        ) : null}
      </h2>
      {action}
    </div>
  );
}

/* ------------------------------------------------------------------
   Surfaces
   ------------------------------------------------------------------ */

export function Panneau({
  children,
  className = "",
  flush = false,
  ton = "papier",
}: {
  children: ReactNode;
  className?: string;
  flush?: boolean;
  /** `or` marque les surfaces de réussite (certificats, maîtrise atteinte). */
  ton?: "papier" | "or" | "encre";
}) {
  const tons = {
    papier: "border-sand-200 bg-white",
    or: "border-gold-400/50 bg-gold-300/10",
    encre: "border-white/10 bg-ink-950 text-white",
  }[ton];
  return (
    <div
      className={`rounded-2xl border shadow-[0_1px_2px_rgba(12,16,43,0.04)] ${tons} ${
        flush ? "" : "p-5"
      } ${className}`}
    >
      {children}
    </div>
  );
}

/** Panneau cliquable : même surface, plus une réaction au survol. */
export function PanneauLien({
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
      className={`block rounded-2xl border border-sand-200 bg-white p-5 shadow-[0_1px_2px_rgba(12,16,43,0.04)] transition duration-200 hover:-translate-y-0.5 hover:border-gold-400/60 hover:shadow-[0_14px_32px_-18px_rgba(12,16,43,0.5)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:ring-offset-2 ${className}`}
    >
      {children}
    </Link>
  );
}

/* ------------------------------------------------------------------
   Chiffres
   ------------------------------------------------------------------ */

/**
 * Tuile de chiffre. Le nombre est en Fraunces, comme sur la page
 * publique : c'est le même geste typographique, donc la même marque.
 */
export function Chiffre({
  valeur,
  libelle,
  detail,
  href,
}: {
  valeur: ReactNode;
  libelle: string;
  detail?: string;
  href?: string;
}) {
  const contenu = (
    <>
      <dt className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
        {libelle}
      </dt>
      <dd className="mt-1.5 font-display text-3xl font-semibold text-ink-900">
        {valeur}
      </dd>
      {detail ? <p className="mt-1 text-xs text-slate-500">{detail}</p> : null}
    </>
  );
  if (href) {
    return (
      <Link
        href={href}
        className="rounded-2xl border border-sand-200 bg-white p-5 transition duration-200 hover:-translate-y-0.5 hover:border-gold-400/60 hover:shadow-[0_12px_28px_-18px_rgba(12,16,43,0.5)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400"
      >
        {contenu}
      </Link>
    );
  }
  return (
    <div className="rounded-2xl border border-sand-200 bg-white p-5">{contenu}</div>
  );
}

/* ------------------------------------------------------------------
   Progression et maîtrise
   ------------------------------------------------------------------ */

/** Barre de complétion d'une formation. */
export function Jauge({
  pourcent,
  libelle,
}: {
  pourcent: number;
  libelle?: string;
}) {
  const valeur = Math.max(0, Math.min(100, Math.round(pourcent)));
  return (
    <div>
      <div
        role="progressbar"
        aria-valuenow={valeur}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={libelle ?? "Progression"}
        className="h-1.5 w-full overflow-hidden rounded-full bg-sand-100"
      >
        <div
          className={`h-full rounded-full transition-[width] duration-500 ${
            valeur === 100 ? "bg-gold-400" : "bg-brand-600"
          }`}
          style={{ width: `${valeur}%` }}
        />
      </div>
      {libelle ? (
        <p className="mt-1.5 text-xs text-slate-500">{libelle}</p>
      ) : null}
    </div>
  );
}

/**
 * Jauge de maîtrise à quatre crans. Le quatrième reste creux tant qu'un
 * humain ne l'a pas accordé : le calcul automatique plafonne à « Avancé »
 * (règle §19 du document global), et l'interface doit le montrer plutôt
 * que de laisser croire à un plafond atteint.
 */
const RANG_NIVEAU: Record<string, number> = {
  fundamentals: 1,
  operational: 2,
  advanced: 3,
  elite: 4,
};

export function CransMaitrise({ niveau }: { niveau: string | null }) {
  const rang = niveau ? (RANG_NIVEAU[niveau] ?? 0) : 0;
  return (
    <span aria-hidden className="flex shrink-0 gap-1">
      {[1, 2, 3, 4].map((cran) => (
        <span
          key={cran}
          className={`h-1.5 w-4 rounded-full ${
            cran <= rang
              ? cran === 4
                ? "bg-gold-500"
                : "bg-brand-600"
              : "bg-sand-200"
          }`}
        />
      ))}
    </span>
  );
}

/* ------------------------------------------------------------------
   Étiquettes et états
   ------------------------------------------------------------------ */

export function Etiquette({
  children,
  ton = "neutre",
}: {
  children: ReactNode;
  ton?: "neutre" | "or" | "succes" | "alerte";
}) {
  const tons = {
    neutre: "bg-sand-100 text-slate-600",
    or: "bg-gold-300/25 text-gold-600",
    succes: "bg-emerald-50 text-emerald-700",
    alerte: "bg-red-50 text-red-700",
  }[ton];
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-[0.08em] ${tons}`}
    >
      {children}
    </span>
  );
}

/**
 * État vide. Il ne se contente pas de constater l'absence : il propose
 * l'action qui la fait disparaître, sinon l'écran est un cul-de-sac.
 */
export function Vide({
  titre,
  texte,
  action,
}: {
  titre: string;
  texte?: string;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-dashed border-sand-200 bg-sand-50/60 px-6 py-12 text-center">
      <p className="font-display text-lg font-semibold text-ink-900">{titre}</p>
      {texte ? (
        <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-slate-500">
          {texte}
        </p>
      ) : null}
      {action ? <div className="mt-5 flex justify-center">{action}</div> : null}
    </div>
  );
}

/* ------------------------------------------------------------------
   Actions
   ------------------------------------------------------------------ */

const BASE_BOUTON =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:ring-offset-2 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-55";

export function BoutonOr(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={`${BASE_BOUTON} bg-gold-400 text-ink-950 shadow-[0_6px_18px_-6px_rgba(211,160,50,0.6)] hover:bg-gold-300 ${props.className ?? ""}`}
    />
  );
}

export function LienOr({
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
      className={`${BASE_BOUTON} bg-gold-400 text-ink-950 shadow-[0_6px_18px_-6px_rgba(211,160,50,0.6)] hover:bg-gold-300 ${className}`}
    >
      {children}
    </Link>
  );
}

export function LienSobre({
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
      className={`${BASE_BOUTON} border border-sand-200 bg-white font-medium text-ink-900 hover:border-slate-300 hover:bg-sand-50 ${className}`}
    >
      {children}
    </Link>
  );
}

/* ------------------------------------------------------------------
   Formulaires
   ------------------------------------------------------------------ */

export function Champ({
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

const SAISIE =
  "block min-h-11 w-full rounded-xl border border-sand-200 bg-sand-50/60 px-3.5 py-2.5 text-base text-ink-900 " +
  "placeholder:text-slate-400 outline-none transition duration-200 hover:bg-white " +
  "focus:border-gold-400 focus:bg-white focus:ring-4 focus:ring-gold-300/25 " +
  "disabled:cursor-not-allowed disabled:bg-sand-100 disabled:text-slate-500 sm:text-sm";

export function Saisie(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${SAISIE} ${props.className ?? ""}`} />;
}

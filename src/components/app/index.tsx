/**
 * Composants des écrans CONNECTÉS.
 *
 * Vocabulaire plus riche que `@/components/ui` (chiffres, jauges,
 * panneaux, états vides), sur la même matière : surfaces blanches à
 * bordure fine, vert d'action, ambre des réussites.
 *
 * Règles conservées : cible tactile d'au moins 44 px, champs à 16 px sous
 * `sm` (pas de zoom iOS), rangées qui se replient plutôt que de comprimer.
 */

import Link from "next/link";
import type { ReactNode } from "react";
import {
  BASE_BOUTON,
  BOUTON_PRINCIPAL,
  BOUTON_SOBRE,
  CLASSES_CHAMP,
  TONS_PASTILLE,
} from "@/components/ui";

/* ------------------------------------------------------------------
   En-têtes
   ------------------------------------------------------------------ */

export { Retour } from "@/components/nav/Retour";

/**
 * En-tête d'écran : contexte discret au-dessus, titre, phrase de
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
    <header className="mb-8 flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
      <div className="min-w-0">
        {eyebrow ? (
          <p className="text-sm font-medium text-slate-500">{eyebrow}</p>
        ) : null}
        <h1 className="mt-1 text-[1.75rem] font-semibold leading-tight tracking-[-0.03em] text-ink-950 sm:text-[2rem]">
          {children}
        </h1>
        {intro ? (
          <p className="mt-2 max-w-2xl text-[15px] leading-relaxed text-slate-600">
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
    <div className="mb-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
      <h2 className="flex items-center gap-2 text-base font-semibold tracking-[-0.01em] text-ink-900">
        {children}
        {compte !== undefined ? (
          <span className="rounded-md bg-sand-100 px-1.5 py-0.5 text-xs font-medium tabular-nums text-slate-600">
            {compte}
          </span>
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
  /**
   * `or` marque les surfaces de réussite (certificats, maîtrise atteinte).
   * `encre` est la surface d'appel d'un écran — une seule par écran.
   */
  ton?: "papier" | "or" | "encre";
}) {
  const tons = {
    papier: "border-sand-200 bg-white shadow-[0_1px_2px_rgba(17,20,18,0.04)]",
    or: "border-gold-400/40 bg-gold-300/10",
    encre: "border-brand-900 bg-brand-900 text-white",
  }[ton];
  return (
    <div className={`rounded-xl border ${tons} ${flush ? "" : "p-5 sm:p-6"} ${className}`}>
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
      className={`group block rounded-xl border border-sand-200 bg-white p-5 shadow-[0_1px_2px_rgba(17,20,18,0.04)] transition-[border-color,box-shadow] duration-150 hover:border-sand-300 hover:shadow-[0_6px_20px_-10px_rgba(17,20,18,0.22)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 ${className}`}
    >
      {children}
    </Link>
  );
}

/* ------------------------------------------------------------------
   Chiffres
   ------------------------------------------------------------------ */

/** Tuile de chiffre : libellé, valeur, précision. */
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
      <dt className="text-sm font-medium text-slate-500">{libelle}</dt>
      <dd className="mt-2 text-[1.75rem] font-semibold leading-none tracking-[-0.03em] tabular-nums text-ink-950">
        {valeur}
      </dd>
      {detail ? <p className="mt-2 text-xs text-slate-500">{detail}</p> : null}
    </>
  );
  const base =
    "rounded-xl border border-sand-200 bg-white p-4 shadow-[0_1px_2px_rgba(17,20,18,0.04)] sm:p-5";
  if (href) {
    return (
      <Link
        href={href}
        className={`${base} transition-[border-color,box-shadow] duration-150 hover:border-sand-300 hover:shadow-[0_6px_20px_-10px_rgba(17,20,18,0.22)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600`}
      >
        {contenu}
      </Link>
    );
  }
  return <div className={base}>{contenu}</div>;
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
        className="h-2 w-full overflow-hidden rounded-full bg-sand-200"
      >
        <div
          className={`h-full rounded-full transition-[width] duration-500 ${
            valeur === 100 ? "bg-gold-500" : "bg-brand-600"
          }`}
          style={{ width: `${valeur}%` }}
        />
      </div>
      {libelle ? <p className="mt-1.5 text-xs text-slate-500">{libelle}</p> : null}
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
          className={`h-2 w-5 rounded-[3px] ${
            cran <= rang ? (cran === 4 ? "bg-gold-500" : "bg-brand-600") : "bg-sand-200"
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
  ton?: keyof typeof TONS_PASTILLE;
}) {
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset first-letter:uppercase ${TONS_PASTILLE[ton]}`}
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
    <div className="rounded-xl border border-dashed border-sand-300 bg-white px-6 py-12 text-center">
      <p className="text-base font-semibold text-ink-900">{titre}</p>
      {texte ? (
        <p className="mx-auto mt-1.5 max-w-md text-sm leading-relaxed text-slate-500">
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

/** Action principale d'un écran. Le nom date de l'ancienne charte. */
export function BoutonOr(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={`${BASE_BOUTON} ${BOUTON_PRINCIPAL} ${props.className ?? ""}`}
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
    <Link href={href} className={`${BASE_BOUTON} ${BOUTON_PRINCIPAL} ${className}`}>
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
    <Link href={href} className={`${BASE_BOUTON} ${BOUTON_SOBRE} ${className}`}>
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
      {hint ? <span className="text-xs text-slate-500">{hint}</span> : null}
    </label>
  );
}

export function Saisie(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${CLASSES_CHAMP} ${props.className ?? ""}`} />;
}

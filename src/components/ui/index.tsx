/**
 * Primitives d'interface partagées – volontairement simples.
 * Chaque composant sépare structure et affichage, sans logique métier.
 *
 * Habillage : surfaces blanches à bordure fine, vert d'action, ambre
 * pour les réussites. L'API n'a pas bougé : c'est ce qui permet de
 * rhabiller tous les écrans sans toucher à leur structure, donc sans
 * risquer d'en casser la logique.
 *
 * `@/components/app` reste distinct : il offre un vocabulaire plus
 * riche (Chiffre, Jauge, Panneau, Vide…) pensé pour les écrans de
 * suivi. Les deux jeux partagent la même matière.
 *
 * Règles responsives appliquées ici une fois pour toutes :
 * - toute cible tactile mesure au moins 44 px de haut (`min-h-11`) ;
 * - les champs de saisie affichent 16 px sous `sm` : en dessous, iOS
 *   zoome automatiquement à la mise au point et décale la page ;
 * - les rangées titre + action passent en colonne quand la largeur
 *   manque, au lieu de comprimer le texte.
 */

import Link from "next/link";
import type { ReactNode } from "react";

/**
 * Bouton de retour standard : présent en tête de chaque écran, y compris
 * les écrans de premier niveau, pour qu'on puisse toujours revenir sans
 * passer par la navigation latérale.
 */
export { Retour } from "@/components/nav/Retour";

/**
 * Carte de contenu. `flush` supprime la marge intérieure pour les cartes
 * qui contiennent un tableau ou un média bord à bord : passer `p-0` par
 * `className` ne suffit pas, Tailwind n'arbitre pas les conflits de
 * classes et l'ordre du fichier CSS généré l'emporte.
 */
export function Card({
  children,
  className = "",
  flush = false,
}: {
  children: ReactNode;
  className?: string;
  flush?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border border-sand-200 bg-white shadow-[0_1px_2px_rgba(17,20,18,0.04)] ${
        flush ? "" : "p-4 sm:p-6"
      } ${className}`}
    >
      {children}
    </div>
  );
}

export function PageTitle({
  children,
  action,
}: {
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-x-4 gap-y-3 sm:items-center">
      <h1 className="min-w-0 text-2xl font-semibold tracking-[-0.025em] text-ink-900 sm:text-[1.75rem]">
        {children}
      </h1>
      {action ? <div className="flex shrink-0 flex-wrap gap-2">{action}</div> : null}
    </div>
  );
}

export function Label({ htmlFor, children }: { htmlFor: string; children: ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="mb-1.5 block text-sm font-medium text-ink-900">
      {children}
    </label>
  );
}

/** Base commune aux champs : 16 px sur mobile (pas de zoom iOS), 14 px ensuite. */
export const CLASSES_CHAMP =
  "block min-h-11 w-full rounded-lg border border-sand-300 bg-white px-3.5 py-2.5 text-base text-ink-900 " +
  "shadow-[0_1px_2px_rgba(17,20,18,0.04)] placeholder:text-slate-400 outline-none transition duration-150 " +
  "hover:border-slate-300 focus:border-brand-600 focus:ring-4 focus:ring-brand-600/15 " +
  "disabled:cursor-not-allowed disabled:bg-sand-100 disabled:text-slate-500 sm:text-sm";

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${CLASSES_CHAMP} ${props.className ?? ""}`} />;
}

export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`${CLASSES_CHAMP} ${props.className ?? ""}`} />;
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`${CLASSES_CHAMP} ${props.className ?? ""}`} />;
}

/** Socle commun aux boutons et aux liens-boutons. */
export const BASE_BOUTON =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold " +
  "transition-[background-color,border-color,color,box-shadow] duration-150 focus-visible:outline-none " +
  "focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 active:translate-y-px " +
  "disabled:cursor-not-allowed disabled:opacity-55";

export const BOUTON_PRINCIPAL =
  "bg-brand-700 text-white shadow-[0_1px_2px_rgba(17,20,18,0.16),inset_0_1px_0_rgba(255,255,255,0.1)] hover:bg-brand-800";

export const BOUTON_SOBRE =
  "border border-sand-300 bg-white font-medium text-ink-900 shadow-[0_1px_2px_rgba(17,20,18,0.05)] hover:border-slate-300 hover:bg-sand-50";

export function PrimaryButton(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={`${BASE_BOUTON} ${BOUTON_PRINCIPAL} ${props.className ?? ""}`}
    />
  );
}

/** Action principale sous forme de lien. */
export function PrimaryLink({
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

export function SecondaryLink({
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

/** Action secondaire sous forme de bouton (soumission d'un formulaire). */
export function SecondaryButton(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={`${BASE_BOUTON} ${BOUTON_SOBRE} ${props.className ?? ""}`}
    />
  );
}

/**
 * Lien à l'intérieur d'un texte ou d'une carte. La couleur ET le souligné
 * signalent le lien : il reste reconnaissable sans dépendre de la
 * perception des couleurs.
 */
export function LienTexte({
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
      className={`rounded-sm font-medium text-brand-700 underline decoration-brand-700/30 underline-offset-[3px] transition-colors duration-150 hover:text-brand-800 hover:decoration-brand-800 ${className}`}
    >
      {children}
    </Link>
  );
}

/** Réaction au survol d'une carte cliquable. Même geste que `PanneauLien`. */
export const SURVOL_CARTE =
  "transition-[border-color,box-shadow] duration-150 hover:border-sand-300 hover:shadow-[0_6px_20px_-10px_rgba(17,20,18,0.22)]";

export function Alert({
  kind,
  children,
}: {
  kind: "error" | "success" | "info";
  children: ReactNode;
}) {
  const styles = {
    error: "border-red-200 bg-red-50 text-red-800",
    success: "border-brand-200 bg-brand-50 text-brand-900",
    info: "border-sand-300 bg-sand-100 text-ink-900",
  }[kind];
  return (
    <div
      role={kind === "error" ? "alert" : "status"}
      className={`rounded-lg border px-4 py-3 text-sm leading-relaxed ${styles}`}
    >
      {children}
    </div>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-dashed border-sand-300 bg-white px-6 py-10 text-center sm:py-12">
      <p className="text-base font-semibold text-ink-900">{title}</p>
      {hint ? (
        <p className="mx-auto mt-1.5 max-w-md text-sm leading-relaxed text-slate-500">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Pastille d'état. Même forme que `Etiquette` de `@/components/app` :
 * un statut de formation doit se lire pareil, qu'on soit concepteur ou
 * apprenant.
 */
export const TONS_PASTILLE = {
  neutre: "bg-sand-100 text-slate-700 ring-sand-300/70",
  or: "bg-gold-300/25 text-gold-600 ring-gold-400/40",
  succes: "bg-brand-50 text-brand-700 ring-brand-200",
  alerte: "bg-red-50 text-red-700 ring-red-200",
} as const;

export function Badge({
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
 * Rangée « libellé + actions » d'une liste : sur mobile les actions
 * passent sous le libellé plutôt que de le réduire à quelques mots.
 * `min-w-0` sur la partie texte autorise la troncature à l'intérieur.
 */
export function ListRow({
  children,
  actions,
  className = "",
}: {
  children: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`flex flex-col gap-2 rounded-lg border border-sand-200 bg-sand-50 px-3.5 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-3 ${className}`}
    >
      <div className="min-w-0 text-sm">{children}</div>
      {actions ? <div className="flex shrink-0 flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

/**
 * Conteneur de tableau large : défile horizontalement dans sa carte au
 * lieu d'élargir la page entière. `-mx` + `px` conservent la marge
 * visuelle tout en laissant le tableau atteindre les bords à l'écran.
 */
export function TableScroll({ children }: { children: ReactNode }) {
  return (
    <div className="-mx-4 overflow-x-auto overscroll-x-contain px-4 sm:mx-0 sm:px-0">
      <div className="inline-block min-w-full align-middle">{children}</div>
    </div>
  );
}

/**
 * Composants d'interface réutilisables – volontairement simples.
 * Chaque composant sépare structure et affichage, sans logique métier.
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
 * Lien de retour standard : présent en tête de chaque écran de détail
 * pour que l'utilisateur sache toujours d'où il vient et comment revenir.
 */
export function BackLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="mb-3 inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-brand-600 transition hover:text-brand-800"
    >
      <span aria-hidden>←</span>
      {children}
    </Link>
  );
}

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
      className={`rounded-xl border border-slate-200 bg-white shadow-sm ${
        flush ? "" : "p-4 sm:p-5"
      } ${className}`}
    >
      {children}
    </div>
  );
}

export function PageTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-x-4 gap-y-3 sm:items-center">
      <h1 className="min-w-0 font-display text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
        {children}
      </h1>
      {action ? <div className="flex shrink-0 flex-wrap gap-2">{action}</div> : null}
    </div>
  );
}

export function Label({ htmlFor, children }: { htmlFor: string; children: ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="mb-1 block text-sm font-medium text-slate-700">
      {children}
    </label>
  );
}

/** Base commune aux champs : 16 px sur mobile (pas de zoom iOS), 14 px ensuite. */
const champ =
  "block min-h-11 w-full rounded-lg border border-slate-300 px-3 py-2 text-base shadow-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-200 sm:text-sm";

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${champ} ${props.className ?? ""}`} />;
}

export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`${champ} ${props.className ?? ""}`} />;
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`${champ} bg-white ${props.className ?? ""}`} />;
}

export function PrimaryButton(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={`inline-flex min-h-11 items-center justify-center rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-300 disabled:cursor-not-allowed disabled:opacity-60 ${props.className ?? ""}`}
    />
  );
}

export function SecondaryLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex min-h-11 items-center justify-center rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50"
    >
      {children}
    </Link>
  );
}

export function Alert({
  kind,
  children,
}: {
  kind: "error" | "success" | "info";
  children: ReactNode;
}) {
  const styles = {
    error: "border-red-200 bg-red-50 text-red-800",
    success: "border-green-200 bg-green-50 text-green-800",
    info: "border-blue-200 bg-blue-50 text-blue-800",
  }[kind];
  return (
    <div role={kind === "error" ? "alert" : "status"} className={`rounded-lg border px-4 py-3 text-sm ${styles}`}>
      {children}
    </div>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-center sm:p-8">
      <p className="text-sm font-medium text-slate-700">{title}</p>
      {hint ? <p className="mt-1 text-sm text-slate-500">{hint}</p> : null}
    </div>
  );
}

export function Badge({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full bg-brand-50 px-2.5 py-0.5 text-xs font-medium text-brand-700">
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
      className={`flex flex-col gap-2 rounded-lg bg-slate-50 px-3 py-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3 ${className}`}
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

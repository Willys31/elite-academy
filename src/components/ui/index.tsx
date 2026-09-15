/**
 * Primitives d'interface partagées – volontairement simples.
 * Chaque composant sépare structure et affichage, sans logique métier.
 *
 * Habillage : encre / papier / or, la charte du produit. Ce jeu portait
 * l'habillage bleu d'origine tant que les écrans concepteur et
 * administrateur n'avaient pas été relus ; il les rejoint ici. L'API
 * n'a pas bougé d'un iota — c'est ce qui permet de rhabiller treize
 * écrans sans toucher à leur structure, donc sans risquer d'en casser
 * la logique.
 *
 * `@/components/app` reste distinct : il offre un vocabulaire plus
 * riche (Chiffre, Jauge, Panneau, Vide…) pensé pour les écrans de
 * suivi. Les deux jeux partagent désormais la même matière.
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
 *
 * L'implémentation est commune aux deux jeux (voir
 * `@/components/nav/Retour`) ; seul le ton diffère.
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
      className={`rounded-2xl border border-sand-200 bg-white shadow-[0_1px_2px_rgba(12,16,43,0.04)] ${
        flush ? "" : "p-4 sm:p-5"
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
      <h1 className="min-w-0 font-display text-2xl font-semibold tracking-tight text-ink-900 sm:text-[1.75rem]">
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
const champ =
  "block min-h-11 w-full rounded-xl border border-sand-200 bg-sand-50/60 px-3.5 py-2.5 text-base text-ink-900 " +
  "placeholder:text-slate-400 outline-none transition duration-200 hover:bg-white " +
  "focus:border-gold-400 focus:bg-white focus:ring-4 focus:ring-gold-300/25 " +
  "disabled:cursor-not-allowed disabled:bg-sand-100 disabled:text-slate-500 sm:text-sm";

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${champ} ${props.className ?? ""}`} />;
}

export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`${champ} ${props.className ?? ""}`} />;
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`${champ} ${props.className ?? ""}`} />;
}

/** Socle commun aux boutons et aux liens-boutons. */
const BASE_BOUTON =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold " +
  "transition duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400 " +
  "focus-visible:ring-offset-2 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-55";

const OR = "bg-gold-400 text-ink-950 shadow-[0_6px_18px_-6px_rgba(211,160,50,0.6)] hover:bg-gold-300";
const SOBRE =
  "border border-sand-200 bg-white font-medium text-ink-900 hover:border-slate-300 hover:bg-sand-50";

export function PrimaryButton(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button {...props} className={`${BASE_BOUTON} ${OR} ${props.className ?? ""}`} />
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
    <Link href={href} className={`${BASE_BOUTON} ${OR} ${className}`}>
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
    <Link href={href} className={`${BASE_BOUTON} ${SOBRE} ${className}`}>
      {children}
    </Link>
  );
}

/** Action secondaire sous forme de bouton (soumission d'un formulaire). */
export function SecondaryButton(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button {...props} className={`${BASE_BOUTON} ${SOBRE} ${props.className ?? ""}`} />
  );
}

/**
 * Lien à l'intérieur d'un texte ou d'une carte.
 *
 * Le bleu d'origine signalait le lien à lui seul. Dans la charte, la
 * couleur du texte ne change pas — c'est le souligné or qui porte
 * l'information. Un lien reste donc reconnaissable sans dépendre de la
 * perception des couleurs, ce que le bleu seul ne garantissait pas.
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
      className={`font-medium text-ink-900 underline decoration-gold-400 decoration-2 underline-offset-[3px] transition duration-200 hover:decoration-gold-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:ring-offset-2 ${className}`}
    >
      {children}
    </Link>
  );
}

/** Réaction au survol d'une carte cliquable. Même geste que `PanneauLien`. */
export const SURVOL_CARTE =
  "transition duration-200 hover:-translate-y-0.5 hover:border-gold-400/60 hover:shadow-[0_14px_32px_-18px_rgba(12,16,43,0.5)]";

export function Alert({
  kind,
  children,
}: {
  kind: "error" | "success" | "info";
  children: ReactNode;
}) {
  /* Erreur et succès gardent le rouge et le vert : ce sont des couleurs
     de sens, pas de marque, et les détourner vers l'or rendrait un échec
     indiscernable d'une réussite. L'information, elle, passe à l'or —
     le bleu n'appartenait plus à rien. */
  const styles = {
    error: "border-red-200 bg-red-50 text-red-800",
    success: "border-emerald-200 bg-emerald-50 text-emerald-800",
    info: "border-gold-400/40 bg-gold-300/10 text-ink-900",
  }[kind];
  return (
    <div
      role={kind === "error" ? "alert" : "status"}
      className={`rounded-xl border px-4 py-3 text-sm leading-relaxed ${styles}`}
    >
      {children}
    </div>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-sand-200 bg-sand-50/60 px-6 py-10 text-center sm:py-12">
      <p className="font-display text-lg font-semibold text-ink-900">{title}</p>
      {hint ? (
        <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-slate-500">
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
export function Badge({
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
      className={`flex flex-col gap-2 rounded-xl bg-sand-50 px-3.5 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-3 ${className}`}
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

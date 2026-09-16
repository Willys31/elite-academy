import {
  FAMILLE_LABELS,
  PALIER_LABELS,
  type BadgeDefinition,
} from "@/lib/gamification/badges";
import { Icone, type NomIcone } from "@/components/icons";

/**
 * Carte d'un badge : obtenu (couleur, date) ou verrouillé (gris,
 * condition et avancement visibles — addendum §4.3).
 */

const ICONE_FAMILLE: Record<BadgeDefinition["famille"], NomIcone> = {
  performance: "flamme",
  regularite: "horloge",
  maitrise: "cible",
  progression: "progression",
  session: "session",
  communaute: "mains",
  distinction: "etoile",
};

const COULEUR_PALIER: Record<string, string> = {
  bronze: "bg-[#f3e3d3] text-[#8a4b12] ring-[#e0c3a6]",
  argent: "bg-sand-100 text-slate-700 ring-sand-300",
  or: "bg-gold-300/30 text-gold-600 ring-gold-400/50",
  platine: "bg-brand-50 text-brand-800 ring-brand-200",
};

export function CarteBadge({
  badge,
  obtenuLe,
  actuel,
  nbObtentions = 0,
}: {
  badge: BadgeDefinition;
  /** Date ISO de la première obtention ; null si verrouillé. */
  obtenuLe: string | null;
  /** Avancement du compteur, pour un badge à compteur verrouillé. */
  actuel?: number;
  /** Badges répétables : nombre de fois obtenu. */
  nbObtentions?: number;
}) {
  const obtenu = obtenuLe !== null;
  const special = badge.special;
  const teinte = badge.palier ? COULEUR_PALIER[badge.palier] : "bg-brand-50 text-brand-800 ring-brand-200";

  return (
    <li
      className={`flex gap-3 rounded-xl border p-4 ${
        special && obtenu
          ? "border-gold-400/60 bg-gradient-to-br from-white to-gold-300/15 shadow-[0_1px_2px_rgba(17,20,18,0.05)]"
          : obtenu
            ? "border-sand-200 bg-white shadow-[0_1px_2px_rgba(17,20,18,0.04)]"
            : "border-dashed border-sand-300 bg-sand-50/60"
      }`}
    >
      <span
        aria-hidden
        className={`flex size-11 shrink-0 items-center justify-center rounded-lg ring-1 ring-inset ${
          obtenu ? teinte : "bg-sand-100 text-slate-400 ring-sand-200"
        }`}
      >
        <Icone nom={ICONE_FAMILLE[badge.famille]} className="size-5" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <p className={`font-semibold ${obtenu ? "text-ink-900" : "text-slate-600"}`}>{badge.nom}</p>
          {badge.palier && !badge.nom.includes(PALIER_LABELS[badge.palier]) ? (
            <span className="text-xs text-slate-500">{PALIER_LABELS[badge.palier]}</span>
          ) : null}
          {nbObtentions > 1 ? (
            <span className="rounded-md bg-sand-100 px-1.5 text-xs font-medium tabular-nums text-slate-600">
              ×{nbObtentions}
            </span>
          ) : null}
        </div>
        <p className="mt-0.5 text-sm leading-snug text-slate-600">{badge.description}</p>
        <p className="mt-1.5 text-xs text-slate-500">
          {obtenu
            ? `${FAMILLE_LABELS[badge.famille]} · obtenu le ${new Date(obtenuLe).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })}`
            : badge.cible !== null
              ? `${FAMILLE_LABELS[badge.famille]} · ${Math.min(actuel ?? 0, badge.cible)}/${badge.cible}`
              : special
                ? "Distinction · validée par un formateur"
                : FAMILLE_LABELS[badge.famille]}
        </p>
        {!obtenu && badge.cible !== null ? (
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-sand-200">
            <div
              className="h-full rounded-full bg-brand-400"
              style={{ width: `${Math.min(100, Math.round(((actuel ?? 0) / badge.cible) * 100))}%` }}
            />
          </div>
        ) : null}
      </div>
    </li>
  );
}

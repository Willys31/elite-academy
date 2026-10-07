import { Jauge } from "@/components/app";
import { formaterTaille } from "@/lib/stockage/limites";

/**
 * Jauge d'usage du stockage d'une organisation : « 12,4 Go utilisés
 * sur 20 Go ». Le libellé passe en rouge à partir de 90 % : le
 * prochain gros fichier risque d'être refusé.
 */
export function JaugeStockage({
  usage,
  quota,
  compact = false,
}: {
  usage: number;
  quota: number;
  compact?: boolean;
}) {
  const pourcent = quota > 0 ? (usage / quota) * 100 : 100;
  const alerte = pourcent >= 90;
  const libelle = `${formaterTaille(usage)} utilisés sur ${formaterTaille(quota)}`;

  return (
    <div>
      <Jauge pourcent={pourcent} libelle={undefined} />
      <p
        className={`mt-1.5 text-xs ${alerte ? "font-medium text-red-700" : "text-slate-500"} ${
          compact ? "" : "sm:text-sm"
        }`}
      >
        {libelle}
        {alerte ? " · espace presque épuisé" : ""}
      </p>
    </div>
  );
}

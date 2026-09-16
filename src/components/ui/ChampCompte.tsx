"use client";

import { useId, useState } from "react";
import { CLASSES_CHAMP } from "@/components/ui";

/**
 * Zone de texte avec compteur de caractères et bornes visibles
 * (addendum Situations de travail §10.2). Le compteur passe en rouge
 * hors bornes ; la validation réelle reste côté serveur.
 */
export function ChampCompte({
  name,
  label,
  aide,
  min,
  max,
  rows = 4,
  defaultValue = "",
  required = true,
}: {
  name: string;
  label: string;
  aide?: string;
  min: number;
  max: number;
  rows?: number;
  defaultValue?: string;
  required?: boolean;
}) {
  const id = useId();
  const [longueur, setLongueur] = useState(defaultValue.length);
  const horsBornes = longueur > 0 && (longueur < min || longueur > max);

  return (
    <div>
      <label htmlFor={id} className="mb-1.5 flex items-baseline justify-between gap-3">
        <span className="text-sm font-medium text-ink-900">{label}</span>
        <span
          className={`text-xs tabular-nums ${horsBornes ? "font-medium text-red-700" : "text-slate-500"}`}
          aria-live="polite"
        >
          {longueur}/{max} · min {min}
        </span>
      </label>
      <textarea
        id={id}
        name={name}
        rows={rows}
        required={required}
        minLength={min}
        maxLength={max}
        defaultValue={defaultValue}
        onChange={(e) => setLongueur(e.target.value.length)}
        className={CLASSES_CHAMP}
      />
      {aide ? <p className="mt-1.5 text-xs leading-relaxed text-slate-500">{aide}</p> : null}
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";

/**
 * Démonstration d'une question en atelier présentiel : les réponses des
 * participants arrivent une à une et la répartition se met à jour.
 *
 * Inspiré de « Animated List » de Magic UI, réécrit sans bibliothèque
 * d'animation : une entrée CSS (`.entree-ligne`) suffit, et la
 * préférence « réduire les animations » affiche directement l'état final.
 *
 * Illustration composée de données d'exemple : elle est masquée aux
 * lecteurs d'écran par le parent (`aria-hidden`).
 */

const PARTICIPANTS = [
  { nom: "Awa Koné", choix: "B" },
  { nom: "Koffi N'Guessan", choix: "B" },
  { nom: "Mariam Traoré", choix: "C" },
  { nom: "Yao Kouadio", choix: "B" },
  { nom: "Fatou Diallo", choix: "A" },
  { nom: "Serge Bamba", choix: "B" },
  { nom: "Aïcha Ouattara", choix: "B" },
  { nom: "Jean-Marc Kouassi", choix: "C" },
  { nom: "Nadia Touré", choix: "B" },
  { nom: "Ibrahim Cissé", choix: "D" },
  { nom: "Rachelle Aka", choix: "B" },
  { nom: "Moussa Sangaré", choix: "B" },
] as const;

const OPTIONS = [
  { lettre: "A", texte: "Rappeler le règlement intérieur" },
  { lettre: "B", texte: "Écouter chaque partie séparément" },
  { lettre: "C", texte: "Trancher rapidement" },
  { lettre: "D", texte: "Attendre que la tension retombe" },
] as const;

const BONNE = "B";
const DEPART = 4;

export function ReponsesEnDirect() {
  const [recues, setRecues] = useState(DEPART);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setRecues(PARTICIPANTS.length);
      return;
    }
    const minuterie = setInterval(() => {
      setRecues((n) => (n >= PARTICIPANTS.length ? DEPART : n + 1));
    }, 1700);
    return () => clearInterval(minuterie);
  }, []);

  const arrivees = PARTICIPANTS.slice(0, recues);
  const dernieres = arrivees.slice(-4).reverse();

  return (
    <div className="overflow-hidden rounded-xl border border-sand-200 bg-white shadow-[0_1px_2px_rgba(17,20,18,0.04),0_24px_48px_-24px_rgba(17,20,18,0.18)]">
      <div className="flex items-center justify-between gap-3 border-b border-sand-200 px-5 py-3">
        <p className="flex items-center gap-2 text-sm font-medium text-ink-900">
          <span className="relative flex size-2">
            <span className="absolute inset-0 animate-ping rounded-full bg-brand-500 opacity-60 motion-reduce:animate-none" />
            <span className="relative size-2 rounded-full bg-brand-600" />
          </span>
          Session en direct
        </p>
        <p className="font-mono text-xs tracking-[0.12em] text-slate-500">CODE 7KQ2MD</p>
      </div>

      <div className="px-5 pt-4">
        <p className="text-xs font-medium text-slate-500">Question 3 sur 5</p>
        <p className="mt-1 text-[15px] font-semibold leading-snug text-ink-900">
          Deux collaborateurs s&apos;opposent en réunion. Par quoi commencer ?
        </p>

        <ul className="mt-4 space-y-2.5">
          {OPTIONS.map((o) => {
            const nombre = arrivees.filter((p) => p.choix === o.lettre).length;
            const part = Math.round((nombre / arrivees.length) * 100);
            const bonne = o.lettre === BONNE;
            return (
              <li key={o.lettre}>
                <div className="flex items-baseline justify-between gap-3 text-[13px]">
                  <span className={`truncate ${bonne ? "font-medium text-ink-900" : "text-slate-600"}`}>
                    <span className="mr-1.5 font-mono text-slate-400">{o.lettre}</span>
                    {o.texte}
                  </span>
                  <span className="shrink-0 tabular-nums text-slate-500">{nombre}</span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-sand-100">
                  <div
                    className={`h-full rounded-full transition-[width] duration-500 ease-out ${
                      bonne ? "bg-brand-600" : "bg-slate-300"
                    }`}
                    style={{ width: `${part}%` }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="mt-5 border-t border-sand-200 bg-sand-50 px-5 py-3">
        <div className="flex items-center justify-between text-xs text-slate-500">
          <span>Dernières réponses</span>
          <span className="tabular-nums">
            {recues} / {PARTICIPANTS.length} participants
          </span>
        </div>
        <ul className="mt-2 h-[184px] space-y-1.5 overflow-hidden">
          {dernieres.map((p, i) => (
            <li
              key={`${p.nom}-${recues - i}`}
              className={`flex items-center gap-3 rounded-lg border border-sand-200 bg-white px-3 py-2 ${
                i === 0 ? "entree-ligne" : ""
              }`}
            >
              <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-sand-100 text-[11px] font-semibold text-slate-600">
                {p.nom
                  .split(" ")
                  .map((m) => m.charAt(0))
                  .slice(0, 2)
                  .join("")}
              </span>
              <span className="min-w-0 flex-1 truncate text-[13px] text-ink-900">{p.nom}</span>
              <span
                className={`shrink-0 rounded-md px-1.5 py-0.5 font-mono text-xs font-medium ${
                  p.choix === BONNE
                    ? "bg-brand-50 text-brand-700"
                    : "bg-sand-100 text-slate-600"
                }`}
              >
                {p.choix}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

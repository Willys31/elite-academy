import { Etiquette } from "@/components/app";
import {
  TYPE_DIFFICULTE_LABELS,
  VERDICT_LABELS,
  type PropositionCorrection,
} from "@/lib/ai/precorrection";

/**
 * Proposition de correction de l'IA, montrée au correcteur humain
 * seulement (lot 26). Rien de ce bloc n'est envoyé à l'apprenant : ce
 * que celui-ci lira est le verdict et le commentaire que le formateur
 * enregistre, pré-remplis à partir d'ici et modifiables.
 */
export function PropositionIa({ proposition }: { proposition: PropositionCorrection }) {
  const p = proposition;
  const ton = p.verdict === "acquise" ? "succes" : p.verdict === "non_acquise" ? "alerte" : "or";
  const confiance = Math.round(p.confiance * 100);
  return (
    <div className="mt-3 rounded-lg border border-dashed border-brand-300 bg-brand-50/40 px-3.5 py-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-brand-800">Correction automatique préparée — modifiable</p>
        <div className="flex items-center gap-2">
          <Etiquette ton={ton}>{VERDICT_LABELS[p.verdict]}</Etiquette>
          {p.verdict !== "incertain" ? <span className="text-xs text-slate-500">confiance {confiance} %</span> : null}
        </div>
      </div>

      {p.criteres.length > 0 ? (
        <ul className="mt-2 space-y-1">
          {p.criteres.map((c, i) => (
            <li key={i} className="flex gap-2">
              <span aria-hidden className={c.atteint === true ? "text-green-700" : c.atteint === false ? "text-red-700" : "text-slate-400"}>
                {c.atteint === true ? "✓" : c.atteint === false ? "✗" : "?"}
              </span>
              <span>
                <span className="font-medium text-ink-900">{c.critere}</span>
                {c.observation ? <span className="text-slate-600"> — {c.observation}</span> : null}
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {p.type_difficulte ? (
        <p className="mt-2 text-xs text-slate-600">
          Difficulté repérée : <span className="font-medium">{TYPE_DIFFICULTE_LABELS[p.type_difficulte]}</span>
        </p>
      ) : null}

      {p.points_forts.length > 0 || p.a_travailler.length > 0 ? (
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {p.points_forts.length > 0 ? (
            <div>
              <p className="text-xs font-medium text-slate-500">Points forts</p>
              <ul className="list-disc pl-4 text-slate-700">
                {p.points_forts.map((x, i) => (
                  <li key={i}>{x}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {p.a_travailler.length > 0 ? (
            <div>
              <p className="text-xs font-medium text-slate-500">À travailler</p>
              <ul className="list-disc pl-4 text-slate-700">
                {p.a_travailler.map((x, i) => (
                  <li key={i}>{x}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}

      {p.commentaire_formateur ? (
        <p className="mt-2 border-l-2 border-gold-400 pl-3 text-slate-700">
          <span className="text-xs font-medium text-slate-500">Point d&apos;attention pour vous</span>
          <br />
          {p.commentaire_formateur}
        </p>
      ) : null}
      {p.warnings.length > 0 ? (
        <p className="mt-2 text-xs text-slate-500">{p.warnings.join(" · ")}</p>
      ) : null}
    </div>
  );
}

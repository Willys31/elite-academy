"use client";

import { startTransition, useActionState, useCallback, useEffect, useRef, useState } from "react";
import { expliquerPassage } from "@/app/(app)/tutorat/actions";
import type { ActionState } from "@/app/(app)/catalogue/actions";
import { nettoyerPassage, PASSAGE_MAX } from "@/lib/tutorat/passage";
import { Alert, BASE_BOUTON, BOUTON_SOBRE, Card, CLASSES_CHAMP } from "@/components/ui";
import { Icone } from "@/components/icons";

export interface ExplicationPrecedente {
  id: string;
  passage: string | null;
  texte: string | null;
  date: string;
}

/**
 * « Expliquer ce passage » (lot 28). Le texte de la leçon est rendu
 * ici ; quand l'apprenant en sélectionne un mot ou une expression, un
 * bouton apparaît au-dessus de la sélection. Un champ libre reste
 * toujours disponible (mobile, supports PDF ou vidéo). La réponse du
 * tuteur s'affiche sous le texte ; les explications déjà demandées sur
 * la leçon restent consultables.
 */
export function ExpliquerPassage({
  lessonId,
  texte,
  disponible,
  restantes,
  precedentes,
}: {
  lessonId: string;
  texte: string;
  /** Tuteur configuré (ou mode simulation). */
  disponible: boolean;
  /** Explications et aides restantes aujourd'hui. */
  restantes: number;
  precedentes: ExplicationPrecedente[];
}) {
  const [state, action, enCours] = useActionState<ActionState, FormData>(expliquerPassage, {});
  const conteneur = useRef<HTMLDivElement>(null);
  const [selection, setSelection] = useState<{ texte: string; top: number; left: number } | null>(null);
  const [demande, setDemande] = useState<string | null>(null);
  const [saisie, setSaisie] = useState("");

  const peutDemander = disponible && restantes > 0 && !enCours;

  const demander = useCallback(
    (passage: string) => {
      const p = nettoyerPassage(passage);
      if (!p) return;
      setDemande(p);
      setSelection(null);
      window.getSelection()?.removeAllRanges();
      const fd = new FormData();
      fd.set("lesson_id", lessonId);
      fd.set("passage", p);
      startTransition(() => action(fd));
    },
    [action, lessonId]
  );

  // Sélection dans le texte de la leçon → bouton flottant au-dessus.
  useEffect(() => {
    if (!disponible) return;
    let image: number | null = null;
    const lire = () => {
      image = null;
      const sel = window.getSelection();
      const boite = conteneur.current;
      if (!sel || !boite || sel.rangeCount === 0 || sel.isCollapsed) {
        setSelection(null);
        return;
      }
      const portee = sel.getRangeAt(0);
      if (!boite.contains(portee.startContainer) || !boite.contains(portee.endContainer)) {
        setSelection(null);
        return;
      }
      const brut = nettoyerPassage(sel.toString());
      if (brut.length < 2 || brut.length > PASSAGE_MAX) {
        setSelection(null);
        return;
      }
      const rect = portee.getBoundingClientRect();
      const ref = boite.getBoundingClientRect();
      setSelection({
        texte: brut,
        top: rect.top - ref.top,
        left: Math.min(Math.max(rect.left - ref.left + rect.width / 2, 90), Math.max(90, ref.width - 90)),
      });
    };
    const planifier = () => {
      if (image !== null) return;
      image = window.requestAnimationFrame(lire);
    };
    document.addEventListener("selectionchange", planifier);
    return () => {
      document.removeEventListener("selectionchange", planifier);
      if (image !== null) window.cancelAnimationFrame(image);
    };
  }, [disponible]);

  const apercu = (p: string) => (p.length > 40 ? `${p.slice(0, 38)}…` : p);

  return (
    <div className="space-y-4">
      <Card>
        <div ref={conteneur} className="relative">
          <div className="whitespace-pre-line text-[15px] leading-relaxed text-slate-800">{texte}</div>
          {selection && peutDemander ? (
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => demander(selection.texte)}
              style={{ top: selection.top, left: selection.left }}
              className="absolute z-10 inline-flex min-h-11 -translate-x-1/2 -translate-y-[calc(100%+8px)] items-center gap-1.5 rounded-full bg-ink-900 px-4 text-sm font-medium text-white shadow-lg transition hover:bg-ink-800"
            >
              <Icone nom="robot" className="size-4" />
              Expliquer « {apercu(selection.texte)} »
            </button>
          ) : null}
        </div>
      </Card>

      <Card>
        <h2 className="flex items-center gap-2 font-semibold">
          <Icone nom="robot" className="size-5 text-brand-700" />
          Un mot ou un passage que vous ne comprenez pas ?
        </h2>
        {disponible ? (
          <>
            <p className="mt-1 text-sm text-slate-500">
              Sélectionnez-le dans le texte ci-dessus, ou saisissez-le ici : le tuteur l&apos;explique dans le sens de la leçon.
              {restantes > 0 ? ` ${restantes} explication${restantes > 1 ? "s" : ""} restante${restantes > 1 ? "s" : ""} aujourd'hui.` : ""}
            </p>
            <form
              className="mt-3 flex flex-col gap-2 sm:flex-row"
              onSubmit={(e) => {
                e.preventDefault();
                demander(saisie);
                setSaisie("");
              }}
            >
              <input
                type="text"
                value={saisie}
                onChange={(e) => setSaisie(e.target.value)}
                maxLength={PASSAGE_MAX}
                placeholder="Ex. : marge brute, écoute active…"
                aria-label="Mot ou passage à expliquer"
                disabled={!peutDemander}
                className={`${CLASSES_CHAMP} flex-1`}
              />
              <button type="submit" disabled={!peutDemander || nettoyerPassage(saisie).length < 2} className={`${BASE_BOUTON} ${BOUTON_SOBRE} sm:w-auto`}>
                {enCours ? "Le tuteur réfléchit…" : "Expliquer"}
              </button>
            </form>
            {restantes <= 0 ? (
              <p className="mt-2 text-sm text-slate-500">Vous avez utilisé vos 30 aides du jour : revenez demain, ou partagez votre question dans l&apos;Entraide.</p>
            ) : null}
          </>
        ) : (
          <p className="mt-1 text-sm text-slate-500">Le tuteur n&apos;est pas disponible sur cette installation. Vous pouvez partager votre question dans l&apos;Entraide.</p>
        )}

        {enCours && demande ? (
          <div className="mt-4 rounded-lg border border-sand-200 bg-sand-50 p-3 text-sm text-slate-600">
            <span className="inline-flex items-center gap-2">
              <span aria-hidden className="inline-block size-3.5 animate-spin rounded-full border-2 border-slate-300 border-t-slate-600" />
              Le tuteur prépare l&apos;explication de « {apercu(demande)} »…
            </span>
          </div>
        ) : null}
        {!enCours && state.error ? (
          <div className="mt-4">
            <Alert kind="error">{state.error}</Alert>
          </div>
        ) : null}
        {!enCours && state.success && demande ? (
          <div className="mt-4 rounded-lg border border-brand-200 bg-brand-50/50 p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-brand-800">Explication du tuteur · « {apercu(demande)} »</p>
            <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-ink-900">{state.success}</p>
          </div>
        ) : null}

        {precedentes.length > 0 ? (
          <details className="mt-4 text-sm">
            <summary className="cursor-pointer text-slate-500 hover:text-ink-900">
              Explications précédentes sur cette leçon ({precedentes.length})
            </summary>
            <ul className="mt-2 space-y-2">
              {precedentes.map((e) => (
                <li key={e.id} className="rounded-lg border border-sand-200 bg-sand-50 p-3">
                  <p className="text-xs font-medium text-slate-500">
                    « {e.passage ?? "passage"} » ·{" "}
                    {new Date(e.date).toLocaleString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                  </p>
                  <p className="mt-1 whitespace-pre-line leading-relaxed text-ink-900">{e.texte}</p>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </Card>
    </div>
  );
}

"use client";

import { startTransition, useActionState, useCallback, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { relancerCorrection } from "@/app/(app)/formations/actions";
import type { ActionState } from "@/app/(app)/catalogue/actions";
import { Alert, BASE_BOUTON, BOUTON_SOBRE } from "@/components/ui";

/**
 * Copie en cours de correction (lot 27 bis). La correction automatique
 * se lance à l'envoi ; si elle n'a pas abouti (service indisponible,
 * page quittée avant la fin), ce composant la relance de lui-même dès
 * que l'apprenant revient sur l'activité, puis rafraîchit la page une
 * fois la note posée. Aucun formateur n'est sollicité.
 */
export function RelanceCorrection({ attemptId }: { attemptId: string }) {
  const [state, action, enCours] = useActionState<ActionState, FormData>(relancerCorrection, {});
  const router = useRouter();
  const lancee = useRef(false);

  const lancer = useCallback(() => {
    const fd = new FormData();
    fd.set("attempt_id", attemptId);
    startTransition(() => action(fd));
  }, [action, attemptId]);

  useEffect(() => {
    if (lancee.current) return;
    lancee.current = true;
    lancer();
  }, [lancer]);

  useEffect(() => {
    if (state.success) router.refresh();
  }, [state.success, router]);

  if (state.error && !enCours) {
    return (
      <div className="space-y-3">
        <Alert kind="error">{state.error}</Alert>
        <button type="button" onClick={lancer} className={`${BASE_BOUTON} ${BOUTON_SOBRE}`}>
          Relancer la correction
        </button>
      </div>
    );
  }
  if (state.success && !enCours) {
    return <Alert kind="success">{state.success}</Alert>;
  }
  return (
    <Alert kind="info">
      <span className="inline-flex items-center gap-2">
        <span aria-hidden className="inline-block size-3.5 animate-spin rounded-full border-2 border-slate-300 border-t-slate-600" />
        Correction en cours… Le résultat et le commentaire s&apos;afficheront ici dans quelques instants, en général moins d&apos;une minute.
      </span>
    </Alert>
  );
}

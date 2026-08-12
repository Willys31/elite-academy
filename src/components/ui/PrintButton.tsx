"use client";

/** Bouton d'impression (masqué à l'impression). */
export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="no-print inline-flex min-h-11 items-center rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
    >
      Imprimer ou enregistrer en PDF
    </button>
  );
}

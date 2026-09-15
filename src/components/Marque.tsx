/**
 * Marque Elite Academy : un monogramme et le nom.
 *
 * Le monogramme dessine un « E » en quatre traits — trois barres et
 * leur montant. C'est aussi une échelle : les paliers de maîtrise que
 * la plateforme mesure. Aucun lien ici ; l'appelant l'enveloppe s'il
 * doit être cliquable.
 */
export function Marque({
  className = "",
  texte = true,
  clair = false,
}: {
  className?: string;
  /** `false` n'affiche que le monogramme. */
  texte?: boolean;
  /** Version pour fond sombre. */
  clair?: boolean;
}) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <svg aria-hidden viewBox="0 0 32 32" className="size-7 shrink-0">
        <rect
          width="32"
          height="32"
          rx="8"
          className={clair ? "fill-white" : "fill-brand-700"}
        />
        <path
          d="M11 9.5h10M11 16h7M11 22.5h10M11 9.5v13"
          fill="none"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={clair ? "stroke-brand-800" : "stroke-white"}
        />
      </svg>
      {texte ? (
        <span
          className={`whitespace-nowrap text-[17px] font-semibold tracking-[-0.02em] ${
            clair ? "text-white" : "text-ink-900"
          }`}
        >
          Elite Academy
        </span>
      ) : null}
    </span>
  );
}

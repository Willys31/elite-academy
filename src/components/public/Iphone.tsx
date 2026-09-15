import type { ReactNode } from "react";

/**
 * Cadre de téléphone pour présenter un écran réel du produit.
 *
 * Adapté du composant « iPhone » de Magic UI (magicui.design) : mêmes
 * proportions et même découpe d'écran, mais l'écran reçoit du contenu
 * React plutôt qu'une image — l'aperçu reste net à toutes les tailles
 * et suit la charte sans capture à régénérer. Coque graphite plutôt
 * que gris clair, pour se détacher d'une page claire.
 */

const LARGEUR = 433;
const HAUTEUR = 882;
const ECRAN_X = 21.25;
const ECRAN_Y = 19.25;
const ECRAN_L = 389.5;
const ECRAN_H = 843.5;
const ECRAN_RAYON = 55.75;

export function Iphone({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`relative w-full leading-none ${className}`}
      style={{ aspectRatio: `${LARGEUR}/${HAUTEUR}` }}
    >
      <div
        className="absolute overflow-hidden bg-white"
        style={{
          left: `${(ECRAN_X / LARGEUR) * 100}%`,
          top: `${(ECRAN_Y / HAUTEUR) * 100}%`,
          width: `${(ECRAN_L / LARGEUR) * 100}%`,
          height: `${(ECRAN_H / HAUTEUR) * 100}%`,
          borderRadius: `${(ECRAN_RAYON / ECRAN_L) * 100}% / ${(ECRAN_RAYON / ECRAN_H) * 100}%`,
        }}
      >
        {children}
      </div>

      <svg
        viewBox={`0 0 ${LARGEUR} ${HAUTEUR}`}
        fill="none"
        className="pointer-events-none absolute inset-0 size-full"
      >
        <defs>
          <mask id="decoupe-ecran" maskUnits="userSpaceOnUse">
            <rect width={LARGEUR} height={HAUTEUR} fill="white" />
            <rect
              x={ECRAN_X}
              y={ECRAN_Y}
              width={ECRAN_L}
              height={ECRAN_H}
              rx={ECRAN_RAYON}
              ry={ECRAN_RAYON}
              fill="black"
            />
          </mask>
        </defs>
        <g mask="url(#decoupe-ecran)">
          <path
            d="M2 73C2 32.68 34.68 0 75 0H357C397.32 0 430 32.68 430 73V809C430 849.32 397.32 882 357 882H75C34.68 882 2 849.32 2 809V73Z"
            fill="#2b2d2c"
          />
          <path d="M0 171a1 1 0 0 1 1-1h2v34H1a1 1 0 0 1-1-1V171Z" fill="#2b2d2c" />
          <path d="M1 234a1 1 0 0 1 1-1h1.5v67H2a1 1 0 0 1-1-1V234Z" fill="#2b2d2c" />
          <path d="M1 319a1 1 0 0 1 1-1h1.5v67H2a1 1 0 0 1-1-1V319Z" fill="#2b2d2c" />
          <path d="M430 279h2a1 1 0 0 1 1 1v104a1 1 0 0 1-1 1h-2V279Z" fill="#2b2d2c" />
          <path
            d="M6 74C6 35.34 37.34 4 76 4H356C394.66 4 426 35.34 426 74V808C426 846.66 394.66 878 356 878H76C37.34 878 6 846.66 6 808V74Z"
            fill="#0d0f0e"
          />
        </g>
        {/* Îlot de la caméra */}
        <path
          d="M154 48.5C154 38.28 162.28 30 172.5 30H259.5C269.72 30 278 38.28 278 48.5S269.72 67 259.5 67H172.5C162.28 67 154 58.72 154 48.5Z"
          fill="#0d0f0e"
        />
        <circle cx="259.5" cy="48.5" r="6" fill="#1c1f1e" />
      </svg>
    </div>
  );
}

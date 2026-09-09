import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Sécurité : ne jamais exposer de secrets ici.
  // Seules les variables préfixées NEXT_PUBLIC_ sont visibles côté navigateur.
  poweredByHeader: false,
  // Analyseurs de documents chargés par Node au runtime, jamais bundlés :
  // pdf-parse embarque un worker pdfjs minifié que webpack casse
  // (« Object.defineProperty called on non-object »).
  serverExternalPackages: ["pdf-parse", "mammoth"],
  // Corollaire de la ligne précédente : « non bundlé » signifie « chargé
  // depuis node_modules à l'exécution ». L'analyse automatique des
  // fichiers tracés ne suit pas jusqu'au bout ces deux paquets (pdf-parse
  // charge son worker pdfjs par un chemin calculé), et ils manquaient à
  // l'exécution en production. On force donc leur inclusion dans les
  // fonctions des deux routes qui les utilisent.
  outputFileTracingIncludes: {
    "/catalogue/importer": [
      "./node_modules/pdf-parse/**/*",
      "./node_modules/mammoth/**/*",
    ],
    "/catalogue/[id]/modifier": [
      "./node_modules/pdf-parse/**/*",
      "./node_modules/mammoth/**/*",
    ],
  },
  experimental: {
    serverActions: {
      // Téléversement de supports de cours (limite alignée sur le
      // bucket Storage : 20 Mo + marge d'encodage).
      bodySizeLimit: "25mb",
    },
  },
};

export default nextConfig;

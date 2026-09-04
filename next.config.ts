import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Sécurité : ne jamais exposer de secrets ici.
  // Seules les variables préfixées NEXT_PUBLIC_ sont visibles côté navigateur.
  poweredByHeader: false,
  // Analyseurs de documents chargés par Node au runtime, jamais bundlés :
  // pdf-parse embarque un worker pdfjs minifié que webpack casse
  // (« Object.defineProperty called on non-object »).
  serverExternalPackages: ["pdf-parse", "mammoth"],
  experimental: {
    serverActions: {
      // Téléversement de supports de cours (limite alignée sur le
      // bucket Storage : 20 Mo + marge d'encodage).
      bodySizeLimit: "25mb",
    },
  },
};

export default nextConfig;

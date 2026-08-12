import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Sécurité : ne jamais exposer de secrets ici.
  // Seules les variables préfixées NEXT_PUBLIC_ sont visibles côté navigateur.
  poweredByHeader: false,
};

export default nextConfig;

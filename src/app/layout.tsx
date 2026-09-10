import type { Metadata, Viewport } from "next";
import "./globals.css";

/**
 * `metadataBase` est indispensable dès qu'une image de partage est
 * déclarée : sans elle, Next.js émet une URL relative, que ni WhatsApp
 * ni LinkedIn ne savent résoudre — l'aperçu reste alors vide.
 * En production, définir NEXT_PUBLIC_SITE_URL sur le domaine réel.
 */
const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://elite-academy-one.vercel.app";

const DESCRIPTION =
  "Plateforme éducative intelligente d'Elite Experience : concevoir, diffuser, personnaliser et certifier des formations professionnelles multi-domaines.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "Elite Academy",
    template: "%s – Elite Academy",
  },
  description: DESCRIPTION,
  applicationName: "Elite Academy",
  /* L'image de partage vient du fichier `opengraph-image.png` posé à côté
     de ce layout : Next.js la déclare seul, ici comme sur Twitter. */
  openGraph: {
    type: "website",
    siteName: "Elite Academy",
    locale: "fr_FR",
    url: SITE_URL,
    title: "Elite Academy — La formation professionnelle qui se prouve",
    description: DESCRIPTION,
  },
  twitter: {
    card: "summary_large_image",
    title: "Elite Academy — La formation professionnelle qui se prouve",
    description: DESCRIPTION,
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  /* La barre d'adresse du navigateur mobile prend la couleur de l'encre :
     l'écran ne se coupe plus en deux au-dessus du héros. */
  themeColor: "#080b1f",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  );
}

import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Elite Academy",
    template: "%s – Elite Academy",
  },
  description:
    "Plateforme éducative intelligente d'Elite Experience : concevoir, diffuser, personnaliser et certifier des formations professionnelles multi-domaines.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
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

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/profile";
import { rejoindreParCode } from "@/app/(app)/sessions/actions";
import { AuthForm } from "@/components/ui/AuthForm";
import { BackLink, Card, Input, Label, PageTitle } from "@/components/ui";

export const metadata: Metadata = { title: "Rejoindre une session" };

/**
 * Rejoindre une session par code (saisie manuelle) ou par QR code
 * (le lien du QR arrive ici avec ?code=XXXXXX prérempli).
 */
export default async function RejoindrePage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/connexion");
  const params = await searchParams;

  return (
    <div className="mx-auto max-w-md">
      <BackLink href="/accueil">Accueil</BackLink>
      <PageTitle>Rejoindre une session</PageTitle>
      <Card>
        <p className="mb-4 text-sm text-slate-600">
          Saisissez le code affiché par votre formateur (ou scannez son QR
          code). Votre présence sera enregistrée automatiquement.
        </p>
        <AuthForm
          action={rejoindreParCode}
          submitLabel="Rejoindre la session"
          pendingLabel="Connexion à la session…"
        >
          <div>
            <Label htmlFor="code">Code de session</Label>
            <Input
              id="code"
              name="code"
              required
              defaultValue={params.code ?? ""}
              placeholder="Ex. : ABC234"
              autoComplete="off"
              className="text-center text-xl font-bold uppercase tracking-[0.3em]"
              maxLength={8}
            />
          </div>
        </AuthForm>
      </Card>
    </div>
  );
}

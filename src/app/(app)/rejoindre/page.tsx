import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/profile";
import { codeValide, normaliserCode } from "@/lib/sessions/sessions";
import { rejoindreParCode } from "@/app/(app)/sessions/actions";
import { AuthForm } from "@/components/ui/AuthForm";
import { Alert, Card, Input, Label, PageTitle, Retour } from "@/components/ui";

export const metadata: Metadata = { title: "Rejoindre une session" };

/**
 * Rejoindre une session par code (saisie manuelle) ou par QR code
 * (le lien du QR arrive ici avec ?code=XXXXXX prérempli).
 *
 * Si le code désigne une session enregistrée, le consentement à
 * l'enregistrement est demandé avant de rejoindre (addendum Sessions
 * hybrides §10.1). Refuser reste possible : la présence est
 * enregistrée, la transcription ne sera pas accessible.
 */
export default async function RejoindrePage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/connexion");
  const params = await searchParams;

  type ApercuSession = { title: string; recording_enabled: boolean; status: string; location: string | null };
  let session: ApercuSession | null = null;
  if (params.code && codeValide(params.code)) {
    const supabase = await createClient();
    const { data } = await supabase
      .from("live_sessions")
      .select("title, recording_enabled, status, location")
      .eq("session_code", normaliserCode(params.code))
      .maybeSingle();
    session = (data as ApercuSession | null) ?? null;
  }

  return (
    <div className="mx-auto max-w-md">
      <Retour href="/accueil" ton="sobre" />
      <PageTitle>Rejoindre une session</PageTitle>
      <Card>
        <p className="mb-4 text-sm text-slate-600">
          Saisissez le code affiché par votre formateur (ou scannez son QR
          code). Votre présence sera enregistrée automatiquement.
        </p>
        {session ? (
          <div className="mb-4">
            <Alert kind={session.status === "open" ? "info" : "error"}>
              <span className="font-medium">{session.title}</span>
              {session.location ? ` · ${session.location}` : ""}
              {session.status !== "open" ? " — cette session n'est pas ouverte." : ""}
            </Alert>
          </div>
        ) : null}
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
          {session?.recording_enabled ? (
            <fieldset className="rounded-lg border border-sand-200 bg-sand-50 p-3">
              <legend className="px-1 text-sm font-medium text-ink-900">Enregistrement de la session</legend>
              <p className="mb-2 text-xs leading-relaxed text-slate-600">
                Cette session est enregistrée et transcrite (tl;dv ou équivalent)
                pour produire un résumé et une analyse pédagogique. Les
                transcriptions sont isolées dans votre organisation et
                conservées 12 mois par défaut.
              </p>
              <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm text-ink-900">
                <input type="checkbox" name="consent" className="size-4 accent-brand-700" />
                J&apos;accepte l&apos;enregistrement et la transcription (accès au résumé)
              </label>
              <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm text-ink-900">
                <input type="checkbox" name="consent_refuse" className="size-4 accent-brand-700" />
                Je refuse l&apos;enregistrement (présence enregistrée, pas d&apos;accès au résumé)
              </label>
            </fieldset>
          ) : null}
        </AuthForm>
      </Card>
    </div>
  );
}

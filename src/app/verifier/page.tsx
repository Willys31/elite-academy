import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import {
  CERT_TYPE_LABELS,
  codeVerificationValide,
  normaliserCodeVerification,
} from "@/lib/certificats/certificats";
import { LEVEL_LABELS } from "@/lib/courses/statuts";

export const metadata: Metadata = { title: "Vérifier un certificat – Elite Academy" };

interface ResultatVerification {
  titulaire: string;
  formation: string;
  organisation: string;
  type_certificat: string;
  niveau: string | null;
  competence: string | null;
  delivre_le: string;
  statut: string;
  revoque_le: string | null;
}

/**
 * Page PUBLIQUE de vérification des certificats (aucun compte requis).
 * Interroge une fonction dédiée qui n'expose que le minimum nécessaire.
 */
export default async function VerifierPage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string }>;
}) {
  const params = await searchParams;
  const saisie = params.code ?? "";
  const code = normaliserCodeVerification(saisie);

  let resultat: ResultatVerification | null = null;
  let formatInvalide = false;
  let introuvable = false;

  if (saisie) {
    if (!codeVerificationValide(code)) {
      formatInvalide = true;
    } else {
      const supabase = await createClient();
      const { data } = await supabase.rpc("verifier_certificat", { code });
      const ligne = Array.isArray(data) ? data[0] : null;
      if (ligne) resultat = ligne as ResultatVerification;
      else introuvable = true;
    }
  }

  const valide = resultat?.statut === "valid";

  return (
    <main className="flex min-h-dvh items-center justify-center bg-sand-50 px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <a href="/" className="font-display text-3xl font-semibold tracking-tight text-brand-800">
            Elite Academy
          </a>
          <p className="mt-2 text-sm text-slate-500">
            Vérification officielle de certificat
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <form method="get" className="space-y-3">
            <label
              htmlFor="code"
              className="block text-sm font-medium text-slate-700"
            >
              Code de vérification
            </label>
            <input
              id="code"
              name="code"
              defaultValue={saisie}
              placeholder="EA-XXXX-XXXX-XXXX"
              autoComplete="off"
              className="block min-h-11 w-full rounded-lg border border-slate-300 px-3 py-2 text-center font-mono text-base uppercase tracking-widest sm:text-sm shadow-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-200"
            />
            <button
              type="submit"
              className="min-h-11 w-full rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-700"
            >
              Vérifier
            </button>
          </form>

          {formatInvalide ? (
            <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
              Le format du code est invalide. Un code de certificat ressemble à
              EA-XXXX-XXXX-XXXX.
            </div>
          ) : null}

          {introuvable ? (
            <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
              Aucun certificat ne correspond à ce code. Vérifiez la saisie ;
              si le code provient d&apos;un document, celui-ci n&apos;est pas
              authentique.
            </div>
          ) : null}

          {resultat ? (
            <div
              className={`mt-4 rounded-lg border px-4 py-4 text-sm ${
                valide
                  ? "border-green-200 bg-green-50"
                  : "border-red-200 bg-red-50"
              }`}
            >
              <p
                className={`font-semibold ${
                  valide ? "text-green-800" : "text-red-800"
                }`}
              >
                {valide
                  ? "✓ Certificat authentique et valide"
                  : "✗ Certificat révoqué — non valide"}
              </p>
              <dl className="mt-3 space-y-1.5 text-slate-700">
                <div className="gap-2 sm:flex sm:justify-between">
                  <dt className="shrink-0 text-slate-500">Titulaire</dt>
                  <dd className="min-w-0 font-medium sm:text-right">{resultat.titulaire}</dd>
                </div>
                <div className="gap-2 sm:flex sm:justify-between">
                  <dt className="shrink-0 text-slate-500">Type</dt>
                  <dd className="min-w-0 sm:text-right">{CERT_TYPE_LABELS[resultat.type_certificat]}</dd>
                </div>
                <div className="gap-2 sm:flex sm:justify-between">
                  <dt className="shrink-0 text-slate-500">Formation</dt>
                  <dd className="min-w-0 sm:text-right">{resultat.formation}</dd>
                </div>
                <div className="gap-2 sm:flex sm:justify-between">
                  <dt className="shrink-0 text-slate-500">Organisation</dt>
                  <dd className="min-w-0 sm:text-right">{resultat.organisation}</dd>
                </div>
                {resultat.competence ? (
                  <div className="gap-2 sm:flex sm:justify-between">
                    <dt className="shrink-0 text-slate-500">Compétence</dt>
                    <dd className="min-w-0 sm:text-right">{resultat.competence}</dd>
                  </div>
                ) : null}
                {resultat.niveau ? (
                  <div className="gap-2 sm:flex sm:justify-between">
                    <dt className="shrink-0 text-slate-500">Niveau</dt>
                    <dd className="min-w-0 sm:text-right">{LEVEL_LABELS[resultat.niveau] ?? resultat.niveau}</dd>
                  </div>
                ) : null}
                <div className="gap-2 sm:flex sm:justify-between">
                  <dt className="shrink-0 text-slate-500">Délivré le</dt>
                  <dd className="min-w-0 sm:text-right">
                    {new Date(resultat.delivre_le).toLocaleDateString("fr-FR")}
                  </dd>
                </div>
                {resultat.revoque_le ? (
                  <div className="gap-2 sm:flex sm:justify-between">
                    <dt className="shrink-0 text-slate-500">Révoqué le</dt>
                    <dd className="min-w-0 sm:text-right">
                      {new Date(resultat.revoque_le).toLocaleDateString("fr-FR")}
                    </dd>
                  </div>
                ) : null}
              </dl>
            </div>
          ) : null}
        </div>
      </div>
    </main>
  );
}

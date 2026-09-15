import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import QRCode from "qrcode";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/profile";
import {
  CERT_STATUS_LABELS,
  CERT_TYPE_LABELS,
} from "@/lib/certificats/certificats";
import { LEVEL_LABELS } from "@/lib/courses/statuts";
import { PrintButton } from "@/components/ui/PrintButton";
import { Alert, Retour } from "@/components/ui";
import { Marque } from "@/components/Marque";

export const metadata: Metadata = { title: "Certificat" };

/**
 * Vue imprimable d'un certificat : identité, formation, date, code
 * unique et QR code menant à la page publique de vérification.
 *
 * Mise en page de document plutôt que de diplôme orné : un titre, un
 * nom, une phrase qui dit ce qui a été validé, puis les éléments de
 * preuve en pied de page. Le double cadre intérieur tient à
 * l'impression sans couleur de fond.
 */
export default async function CertificatPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) redirect("/connexion");

  const supabase = await createClient();
  const { data: certificat } = await supabase
    .from("certificates")
    .select(
      `id, certificate_type, level, verification_code, issued_at, status,
       revoked_at, titulaire:profiles!certificates_user_id_fkey(full_name),
       course:courses(title), organization:organizations(name),
       competency:competencies(name)`
    )
    .eq("id", id)
    .maybeSingle();
  if (!certificat) notFound();

  const titulaire = Array.isArray(certificat.titulaire)
    ? certificat.titulaire[0]
    : certificat.titulaire;
  const course = Array.isArray(certificat.course)
    ? certificat.course[0]
    : certificat.course;
  const organisation = Array.isArray(certificat.organization)
    ? certificat.organization[0]
    : certificat.organization;
  const competence = Array.isArray(certificat.competency)
    ? certificat.competency[0]
    : certificat.competency;

  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? "http";
  const urlVerification = `${proto}://${host}/verifier?code=${certificat.verification_code}`;
  const qrDataUrl = await QRCode.toDataURL(urlVerification, { width: 140, margin: 1 });

  const details: Array<[string, string]> = [
    ["Délivré le", new Date(certificat.issued_at).toLocaleDateString("fr-FR", {
      day: "numeric",
      month: "long",
      year: "numeric",
    })],
  ];
  if (certificat.level) {
    details.unshift(["Niveau", LEVEL_LABELS[certificat.level] ?? certificat.level]);
  }
  if (competence?.name) details.unshift(["Compétence", competence.name]);

  return (
    <div className="mx-auto max-w-3xl">
      <div className="no-print mb-4 flex flex-wrap items-center justify-between gap-3">
        <Retour href="/certificats" />
        <PrintButton />
      </div>

      {certificat.status === "revoked" ? (
        <div className="no-print mb-4">
          <Alert kind="error">
            Ce certificat a été révoqué
            {certificat.revoked_at
              ? ` le ${new Date(certificat.revoked_at).toLocaleDateString("fr-FR")}`
              : ""}
            . Il n&apos;est plus valide.
          </Alert>
        </div>
      ) : null}

      {/* Certificat imprimable */}
      <div className="print-plain rounded-xl border border-sand-200 bg-white p-2 shadow-[0_1px_2px_rgba(17,20,18,0.05),0_24px_48px_-28px_rgba(17,20,18,0.25)]">
        <div className="rounded-lg border border-sand-300 px-6 py-8 sm:px-12 sm:py-12">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Marque />
            {organisation?.name ? (
              <p className="text-sm text-slate-500">{organisation.name}</p>
            ) : null}
          </div>

          <p className="mt-12 text-sm font-medium text-brand-700 sm:mt-16">
            {CERT_TYPE_LABELS[certificat.certificate_type]}
          </p>
          <p className="mt-4 text-sm text-slate-500">Décerné à</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-[-0.035em] text-ink-950 sm:text-[2.75rem] sm:leading-tight">
            {titulaire?.full_name}
          </h1>
          <p className="mt-5 max-w-lg text-[15px] leading-relaxed text-slate-600">
            pour avoir suivi et validé la formation{" "}
            <span className="font-medium text-ink-900">{course?.title}</span>.
          </p>

          <dl className="mt-8 grid gap-x-8 gap-y-4 sm:grid-cols-3">
            {details.map(([terme, valeur]) => (
              <div key={terme} className="border-t border-sand-200 pt-3">
                <dt className="text-xs text-slate-500">{terme}</dt>
                <dd className="mt-0.5 text-sm font-medium text-ink-900">{valeur}</dd>
              </div>
            ))}
          </dl>

          <div className="mt-12 flex flex-col gap-5 border-t border-sand-200 pt-6 sm:flex-row sm:items-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={qrDataUrl}
              alt="QR code de vérification du certificat"
              className="size-24 shrink-0 rounded-md border border-sand-200 p-1"
            />
            <div className="min-w-0">
              <p className="text-xs text-slate-500">Code de vérification</p>
              <p className="mt-0.5 break-all font-mono text-base font-semibold tracking-[0.1em] text-ink-950">
                {certificat.verification_code}
              </p>
              <p className="mt-2 break-all text-xs leading-relaxed text-slate-500">
                Vérifiable en ligne, sans compte : {urlVerification}
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Statut : {CERT_STATUS_LABELS[certificat.status]}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

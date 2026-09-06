import type { Metadata } from "next";
import Link from "next/link";
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
import { Alert } from "@/components/ui";

export const metadata: Metadata = { title: "Certificat" };

/**
 * Vue imprimable d'un certificat : identité, formation, date, code
 * unique et QR code menant à la page publique de vérification.
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

  return (
    <div className="mx-auto max-w-2xl">
      <div className="no-print mb-4 flex flex-wrap items-center justify-between gap-3">
        <Link href="/certificats" className="text-sm text-brand-600 hover:underline">
          ← Mes certificats
        </Link>
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
      <div className="print-plain rounded-xl border-4 border-double border-brand-700 bg-white px-5 py-8 text-center sm:px-10 sm:py-12">
        <p className="text-xs uppercase tracking-[0.15em] text-slate-500 sm:text-sm sm:tracking-widest">
          Elite Academy — {organisation?.name}
        </p>
        <h1 className="mt-4 text-xl font-bold text-brand-800 sm:text-3xl">
          {CERT_TYPE_LABELS[certificat.certificate_type]}
        </h1>

        <p className="mt-8 text-sm text-slate-500">décerné à</p>
        <p className="mt-1 text-xl font-semibold sm:text-2xl">{titulaire?.full_name}</p>

        <p className="mt-6 text-sm text-slate-500">pour la formation</p>
        <p className="mt-1 text-lg font-medium">{course?.title}</p>

        {competence?.name ? (
          <p className="mt-3 text-sm text-slate-600">
            Compétence : {competence.name}
          </p>
        ) : null}
        {certificat.level ? (
          <p className="mt-1 text-sm text-slate-600">
            Niveau : {LEVEL_LABELS[certificat.level] ?? certificat.level}
          </p>
        ) : null}

        <p className="mt-6 text-sm text-slate-500">
          Délivré le{" "}
          {new Date(certificat.issued_at).toLocaleDateString("fr-FR", {
            day: "numeric",
            month: "long",
            year: "numeric",
          })}
        </p>

        <div className="mt-8 flex flex-col items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={qrDataUrl}
            alt="QR code de vérification du certificat"
            className="h-24 w-24 sm:h-28 sm:w-28"
          />
          <p className="break-all font-mono text-sm font-semibold tracking-wide">
            {certificat.verification_code}
          </p>
          <p className="break-all text-xs text-slate-400">
            Vérifiable en ligne : {urlVerification}
          </p>
          <p className="text-xs text-slate-400">
            Statut : {CERT_STATUS_LABELS[certificat.status]}
          </p>
        </div>
      </div>
    </div>
  );
}

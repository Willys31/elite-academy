import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/profile";
import {
  CERT_STATUS_LABELS,
  CERT_TYPE_LABELS,
} from "@/lib/certificats/certificats";
import {
  delivrerCertificat,
  revoquerCertificat,
} from "@/app/(app)/certificats/actions";
import { AuthForm } from "@/components/ui/AuthForm";
import {
  Badge,
  Card,
  EmptyState,
  Label,
  PageTitle,
  Select,
  Textarea,
} from "@/components/ui";

export const metadata: Metadata = { title: "Certificats de la formation" };

/**
 * Délivrance et suivi des certificats d'une formation, réservé à
 * l'encadrement (formateur, responsable, admin, Elite Experience).
 * La délivrance manuelle matérialise la validation humaine exigée
 * pour les certificats de réussite et preuves de compétence.
 */
export default async function CertificatsFormationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) redirect("/connexion");

  const supabase = await createClient();
  const { data: formation } = await supabase
    .from("courses")
    .select("id, title")
    .eq("id", id)
    .maybeSingle();
  if (!formation) notFound();

  const { data: encadre } = await supabase.rpc("oversees_course", { cid: formation.id });
  if (!encadre) redirect(`/catalogue/${formation.id}`);

  const [{ data: inscrits }, { data: certificats }] = await Promise.all([
    supabase
      .from("enrollments")
      .select("user_id, status, profile:profiles!enrollments_user_id_fkey(full_name, email)")
      .eq("course_id", formation.id)
      .order("created_at"),
    supabase
      .from("certificates")
      .select(
        "id, certificate_type, level, verification_code, issued_at, status, titulaire:profiles!certificates_user_id_fkey(full_name)"
      )
      .eq("course_id", formation.id)
      .order("issued_at", { ascending: false }),
  ]);

  return (
    <div>
      <p className="mb-2 text-sm">
        <Link href={`/catalogue/${formation.id}`} className="text-brand-600 hover:underline">
          ← {formation.title}
        </Link>
      </p>
      <PageTitle>Certificats — {formation.title}</PageTitle>

      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <section aria-label="Certificats délivrés">
          <h2 className="mb-3 text-lg font-semibold">Certificats délivrés</h2>
          {!certificats || certificats.length === 0 ? (
            <EmptyState
              title="Aucun certificat délivré"
              hint="Délivrez le premier certificat depuis le formulaire ci-contre."
            />
          ) : (
            <div className="space-y-3">
              {certificats.map((c) => {
                const titulaire = Array.isArray(c.titulaire)
                  ? c.titulaire[0]
                  : c.titulaire;
                return (
                  <Card key={c.id}>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="font-medium">{titulaire?.full_name}</p>
                        <p className="text-sm text-slate-600">
                          {CERT_TYPE_LABELS[c.certificate_type]}
                        </p>
                        <p className="mt-1 text-xs text-slate-400">
                          {c.verification_code} · délivré le{" "}
                          {new Date(c.issued_at).toLocaleDateString("fr-FR")}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge>{CERT_STATUS_LABELS[c.status]}</Badge>
                        {c.status === "valid" ? (
                          <AuthForm
                            action={revoquerCertificat}
                            submitLabel="Révoquer"
                            pendingLabel="…"
                          >
                            <input type="hidden" name="certificate_id" value={c.id} />
                            <input type="hidden" name="course_id" value={formation.id} />
                          </AuthForm>
                        ) : null}
                      </div>
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </section>

        <section aria-label="Délivrer un certificat">
          <Card>
            <h2 className="mb-3 font-semibold">Délivrer un certificat</h2>
            {!inscrits || inscrits.length === 0 ? (
              <p className="text-sm text-slate-500">
                Aucun apprenant inscrit à cette formation.
              </p>
            ) : (
              <AuthForm
                action={delivrerCertificat}
                submitLabel="Délivrer le certificat"
                pendingLabel="Délivrance…"
              >
                <input type="hidden" name="course_id" value={formation.id} />
                <div>
                  <Label htmlFor="user_id">Apprenant</Label>
                  <Select id="user_id" name="user_id" required>
                    {inscrits.map((i) => {
                      const profil = Array.isArray(i.profile)
                        ? i.profile[0]
                        : i.profile;
                      return (
                        <option key={i.user_id} value={i.user_id}>
                          {profil?.full_name || profil?.email}
                          {i.status === "completed" ? " (formation terminée)" : ""}
                        </option>
                      );
                    })}
                  </Select>
                </div>
                <div>
                  <Label htmlFor="certificate_type">Type</Label>
                  <Select id="certificate_type" name="certificate_type" required>
                    <option value="participation">Attestation de participation</option>
                    <option value="success">Certificat de réussite</option>
                    <option value="skill">Preuve de compétence</option>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="level">Niveau (facultatif)</Label>
                  <Select id="level" name="level" defaultValue="">
                    <option value="">— Sans niveau —</option>
                    <option value="fundamentals">Fondamentaux</option>
                    <option value="operational">Opérationnel</option>
                    <option value="advanced">Avancé</option>
                    <option value="elite">Elite (validation humaine : vous)</option>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="commentaire">Justification (facultatif)</Label>
                  <Textarea
                    id="commentaire"
                    name="commentaire"
                    rows={2}
                    placeholder="Ex. : évaluation finale réussie le… ; observation en atelier…"
                  />
                </div>
              </AuthForm>
            )}
            <p className="mt-3 text-xs text-slate-400">
              La délivrance est un acte de validation humaine : appuyez-vous
              sur les résultats, la progression et vos observations.
            </p>
          </Card>
        </section>
      </div>
    </div>
  );
}

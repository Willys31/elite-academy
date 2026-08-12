import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/profile";
import {
  CERT_STATUS_LABELS,
  CERT_TYPE_LABELS,
} from "@/lib/certificats/certificats";
import { reclamerCompletion } from "@/app/(app)/certificats/actions";
import { AuthForm } from "@/components/ui/AuthForm";
import { Badge, Card, EmptyState, PageTitle } from "@/components/ui";

export const metadata: Metadata = { title: "Mes certificats" };

export default async function MesCertificatsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/connexion");

  const supabase = await createClient();
  const [{ data: certificats }, { data: terminees }] = await Promise.all([
    supabase
      .from("certificates")
      .select(
        "id, certificate_type, level, verification_code, issued_at, status, course:courses(title)"
      )
      .eq("user_id", user.id)
      .order("issued_at", { ascending: false }),
    supabase
      .from("enrollments")
      .select("course_id, course:courses(id, title)")
      .eq("user_id", user.id)
      .eq("status", "completed"),
  ]);

  // Formations terminées sans attestation de complétion : réclamables.
  const dejaAttestees = new Set(
    (certificats ?? [])
      .filter((c) => c.certificate_type === "completion")
      .map((c) => {
        const course = Array.isArray(c.course) ? c.course[0] : c.course;
        return course?.title;
      })
  );
  const reclamables = (terminees ?? []).filter((t) => {
    const course = Array.isArray(t.course) ? t.course[0] : t.course;
    return course && !dejaAttestees.has(course.title);
  });

  return (
    <div>
      <PageTitle>Mes certificats</PageTitle>

      {reclamables.length > 0 ? (
        <Card className="mb-6 border-brand-200 bg-brand-50/50">
          <h2 className="mb-2 font-semibold">Attestations disponibles</h2>
          <p className="mb-3 text-sm text-slate-600">
            Vous avez terminé ces formations : générez votre attestation de
            complétion.
          </p>
          <div className="space-y-3">
            {reclamables.map((r) => {
              const course = Array.isArray(r.course) ? r.course[0] : r.course;
              if (!course) return null;
              return (
                <div
                  key={r.course_id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-white px-3 py-2"
                >
                  <span className="text-sm font-medium">{course.title}</span>
                  <AuthForm
                    action={reclamerCompletion}
                    submitLabel="Générer mon attestation"
                    pendingLabel="Génération…"
                  >
                    <input type="hidden" name="course_id" value={r.course_id} />
                  </AuthForm>
                </div>
              );
            })}
          </div>
        </Card>
      ) : null}

      {!certificats || certificats.length === 0 ? (
        <EmptyState
          title="Aucun certificat pour le moment"
          hint="Terminez une formation pour obtenir votre attestation de complétion ; les certificats de réussite sont délivrés par vos formateurs."
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {certificats.map((c) => {
            const course = Array.isArray(c.course) ? c.course[0] : c.course;
            return (
              <Link key={c.id} href={`/certificats/${c.id}`}>
                <Card className="h-full transition hover:border-brand-300 hover:shadow">
                  <div className="flex items-start justify-between gap-2">
                    <h2 className="font-semibold">
                      {CERT_TYPE_LABELS[c.certificate_type]}
                    </h2>
                    <Badge>{CERT_STATUS_LABELS[c.status]}</Badge>
                  </div>
                  <p className="mt-1 text-sm text-slate-600">{course?.title}</p>
                  <p className="mt-2 text-xs text-slate-400">
                    Délivré le {new Date(c.issued_at).toLocaleDateString("fr-FR")} ·
                    code {c.verification_code}
                  </p>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/profile";
import {
  CERT_STATUS_LABELS,
  CERT_TYPE_LABELS,
} from "@/lib/certificats/certificats";
import { reclamerCompletion } from "@/app/(app)/certificats/actions";
import { AuthForm } from "@/components/ui/AuthForm";
import {
  EcranTitre,
  Etiquette,
  LienOr,
  Panneau,
  PanneauLien,
  SectionTitre,
  Vide,
} from "@/components/app";

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
      <EcranTitre
        eyebrow="Vos preuves"
        intro="Chaque certificat porte un code unique. Toute personne à qui vous le communiquez peut en vérifier l'authenticité en ligne, sans compte."
      >
        Mes certificats
      </EcranTitre>

      {/* ---------- À réclamer ---------- */}
      {reclamables.length > 0 ? (
        <Panneau ton="or" className="mb-8">
          <SectionTitre compte={reclamables.length}>
            Attestations disponibles
          </SectionTitre>
          <p className="mb-4 text-sm leading-relaxed text-slate-600">
            Vous avez terminé ces formations. Générez votre attestation de
            complétion : elle recevra son propre code de vérification.
          </p>
          <div className="space-y-3">
            {reclamables.map((r) => {
              const course = Array.isArray(r.course) ? r.course[0] : r.course;
              if (!course) return null;
              return (
                <div
                  key={r.course_id}
                  className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 rounded-xl border border-sand-200 bg-white px-4 py-3"
                >
                  <span className="min-w-0 text-sm font-medium text-ink-900">
                    {course.title}
                  </span>
                  {/* `sm:w-auto` : sur téléphone le bouton prend toute la
                      largeur de la ligne, sinon il se retrouve seul et
                      minuscule sous le titre de la formation. */}
                  <div className="w-full sm:w-auto">
                    <AuthForm
                      action={reclamerCompletion}
                      submitLabel="Générer mon attestation"
                      pendingLabel="Génération…"
                    >
                      <input type="hidden" name="course_id" value={r.course_id} />
                    </AuthForm>
                  </div>
                </div>
              );
            })}
          </div>
        </Panneau>
      ) : null}

      {/* ---------- Certificats obtenus ---------- */}
      {!certificats || certificats.length === 0 ? (
        <Vide
          titre="Aucun certificat pour le moment"
          texte="Terminez une formation pour obtenir votre attestation de complétion. Les certificats de réussite, eux, sont délivrés par vos formateurs."
          action={<LienOr href="/formations">Voir mes formations</LienOr>}
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {certificats.map((c) => {
            const course = Array.isArray(c.course) ? c.course[0] : c.course;
            const revoque = c.status !== "valid";
            return (
              <PanneauLien
                key={c.id}
                href={`/certificats/${c.id}`}
                className={`flex h-full flex-col ${
                  revoque ? "opacity-70" : ""
                }`}
              >
                {/* Filet or en tête : la carte doit se lire comme un
                    document, pas comme une ligne de liste. */}
                <div className="flex items-start justify-between gap-3">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                    Elite Academy
                  </p>
                  <Etiquette ton={revoque ? "alerte" : "succes"}>
                    {CERT_STATUS_LABELS[c.status] ?? c.status}
                  </Etiquette>
                </div>

                <h3 className="mt-3 font-display text-base font-semibold text-brand-800">
                  {CERT_TYPE_LABELS[c.certificate_type] ?? c.certificate_type}
                </h3>
                <p className="mt-1 text-sm text-slate-600">{course?.title}</p>

                <div className="mt-auto pt-5">
                  <div className="h-px w-full bg-gradient-to-r from-gold-400/60 to-transparent" />
                  <p className="mt-3 font-mono text-xs font-semibold tracking-[0.1em] text-slate-600">
                    {c.verification_code}
                  </p>
                  <p className="mt-1 text-xs text-slate-400">
                    Délivré le{" "}
                    {new Date(c.issued_at).toLocaleDateString("fr-FR", {
                      day: "numeric",
                      month: "long",
                      year: "numeric",
                    })}
                  </p>
                </div>
              </PanneauLien>
            );
          })}
        </div>
      )}
    </div>
  );
}

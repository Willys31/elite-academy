import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/profile";
import { isEliteAdmin } from "@/lib/auth/roles";
import {
  canCreateCourse,
  CONTEXT_LABELS,
  FORMAT_LABELS,
  LEVEL_LABELS,
  STATUS_LABELS,
  type CourseStatus,
} from "@/lib/courses/statuts";
import { sInscrireFormation } from "@/app/(app)/formations/actions";
import { AuthForm } from "@/components/ui/AuthForm";
import { BackLink, Badge, Card, EmptyState, PageTitle } from "@/components/ui";

export const metadata: Metadata = { title: "Fiche formation" };

/**
 * Fiche formation (consultation).
 * Conforme à UX/UI §3.3 : titre, objectif, compétences, public,
 * prérequis, durée, format, modules, certification (à venir).
 */
export default async function FicheFormationPage({
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
    .select(
      `id, title, description, status, sector, format, duration_minutes,
       context_type, target_audience, prerequisites, organization_id,
       current_version_id, organization:organizations(name)`
    )
    .eq("id", id)
    .maybeSingle();

  if (!formation) notFound();

  const { data: inscription } = await supabase
    .from("enrollments")
    .select("id")
    .eq("course_id", formation.id)
    .eq("user_id", user.id)
    .maybeSingle();

  const [{ data: competences }, { data: modules }] = await Promise.all([
    supabase
      .from("course_competencies")
      .select("target_level, competency:competencies(name, domain)")
      .eq("course_id", formation.id),
    formation.current_version_id
      ? supabase
          .from("modules")
          .select("id, title, description, position, lessons(id, title, position, estimated_minutes)")
          .eq("course_version_id", formation.current_version_id)
          .order("position")
      : Promise.resolve({ data: [] }),
  ]);

  const org = Array.isArray(formation.organization)
    ? formation.organization[0]
    : formation.organization;
  const peutModifier =
    isEliteAdmin(user.memberships) ||
    canCreateCourse(user.memberships, formation.organization_id);
  const encadre =
    peutModifier ||
    user.memberships.some(
      (m) =>
        m.organization_id === formation.organization_id &&
        m.status === "active" &&
        (m.role === "trainer" || m.role === "manager")
    );

  return (
    <div>
      <BackLink href="/catalogue">Catalogue</BackLink>
      <PageTitle
        action={
          encadre ? (
            <div className="flex flex-wrap gap-2">
              <Link
                href={`/catalogue/${formation.id}/certificats`}
                className="inline-flex min-h-11 items-center rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Certificats
              </Link>
              {peutModifier ? (
                <Link
                  href={`/catalogue/${formation.id}/modifier`}
                  className="inline-flex min-h-11 items-center rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  Modifier
                </Link>
              ) : null}
            </div>
          ) : undefined
        }
      >
        {formation.title}
      </PageTitle>

      <div className="-mt-4 mb-6 flex flex-wrap items-center gap-2 text-sm text-slate-500">
        <Badge>{STATUS_LABELS[formation.status as CourseStatus]}</Badge>
        <span>{org?.name}</span>
        <span>· {CONTEXT_LABELS[formation.context_type] ?? formation.context_type}</span>
        <span>· {FORMAT_LABELS[formation.format] ?? formation.format}</span>
        {formation.duration_minutes ? <span>· {formation.duration_minutes} min</span> : null}
        {formation.sector ? <span>· {formation.sector}</span> : null}
      </div>

      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <div className="space-y-6">
          {formation.description ? (
            <Card>
              <h2 className="mb-2 font-semibold">Présentation</h2>
              <p className="whitespace-pre-line text-sm text-slate-700">
                {formation.description}
              </p>
            </Card>
          ) : null}

          <section aria-label="Programme">
            <h2 className="mb-3 text-lg font-semibold">Programme</h2>
            {!modules || modules.length === 0 ? (
              <EmptyState
                title="Programme en cours de construction"
                hint="Les modules de cette formation ne sont pas encore renseignés."
              />
            ) : (
              <div className="space-y-3">
                {modules.map((m, i) => (
                  <Card key={m.id}>
                    <h3 className="font-medium">
                      Module {i + 1} — {m.title}
                    </h3>
                    {m.description ? (
                      <p className="mt-1 text-sm text-slate-600">{m.description}</p>
                    ) : null}
                    {m.lessons && m.lessons.length > 0 ? (
                      <ul className="mt-2 space-y-1 text-sm text-slate-700">
                        {[...m.lessons]
                          .sort((a, b) => a.position - b.position)
                          .map((l) => (
                            <li key={l.id} className="flex justify-between gap-2">
                              <span>• {l.title}</span>
                              {l.estimated_minutes ? (
                                <span className="text-xs text-slate-400">
                                  {l.estimated_minutes} min
                                </span>
                              ) : null}
                            </li>
                          ))}
                      </ul>
                    ) : null}
                  </Card>
                ))}
              </div>
            )}
          </section>
        </div>

        <div className="space-y-6">
          <Card>
            <h2 className="mb-2 font-semibold">Compétences visées</h2>
            {!competences || competences.length === 0 ? (
              <p className="text-sm text-slate-500">Pas encore renseignées.</p>
            ) : (
              <ul className="space-y-2">
                {competences.map((c, i) => {
                  const comp = Array.isArray(c.competency)
                    ? c.competency[0]
                    : c.competency;
                  return (
                    <li key={i} className="text-sm">
                      <span className="font-medium">{comp?.name}</span>{" "}
                      <Badge>{LEVEL_LABELS[c.target_level] ?? c.target_level}</Badge>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          {formation.target_audience ? (
            <Card>
              <h2 className="mb-2 font-semibold">Public cible</h2>
              <p className="text-sm text-slate-700">{formation.target_audience}</p>
            </Card>
          ) : null}

          {formation.prerequisites ? (
            <Card>
              <h2 className="mb-2 font-semibold">Prérequis</h2>
              <p className="text-sm text-slate-700">{formation.prerequisites}</p>
            </Card>
          ) : null}

          <Card>
            <h2 className="mb-2 font-semibold">Inscription</h2>
            {inscription ? (
              <div>
                <p className="mb-3 text-sm text-slate-600">
                  Vous êtes inscrit à cette formation.
                </p>
                <Link
                  href={`/formations/${formation.id}`}
                  className="inline-flex min-h-11 items-center rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
                >
                  Continuer la formation
                </Link>
              </div>
            ) : formation.status === "published" ? (
              <AuthForm
                action={sInscrireFormation}
                submitLabel="S'inscrire à la formation"
                pendingLabel="Inscription…"
              >
                <input type="hidden" name="course_id" value={formation.id} />
              </AuthForm>
            ) : (
              <p className="text-sm text-slate-500">
                L&apos;inscription sera possible une fois la formation publiée.
              </p>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/profile";
import { calculerCompletion } from "@/lib/courses/progression";
import { BackLink, Badge, Card, EmptyState, PageTitle } from "@/components/ui";

export const metadata: Metadata = { title: "Suivre la formation" };

/**
 * Lecteur de cours – vue d'ensemble (UX/UI §3.4) :
 * modules, leçons avec état terminé / à faire, prochaine activité.
 */
export default async function LecteurFormationPage({
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
    .select("id, title, current_version_id, status")
    .eq("id", id)
    .maybeSingle();
  if (!formation) notFound();

  // Inscription requise pour suivre.
  const { data: inscription } = await supabase
    .from("enrollments")
    .select("id, status")
    .eq("course_id", formation.id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!inscription) redirect(`/catalogue/${formation.id}`);

  const { data: modules } = formation.current_version_id
    ? await supabase
        .from("modules")
        .select("id, title, position, lessons(id, title, position, estimated_minutes)")
        .eq("course_version_id", formation.current_version_id)
        .order("position")
    : { data: [] };

  const { data: faites } = await supabase
    .from("progress_records")
    .select("lesson_id")
    .eq("user_id", user.id)
    .eq("course_id", formation.id)
    .not("lesson_id", "is", null);
  const terminees = new Set((faites ?? []).map((f) => f.lesson_id));

  const toutesLecons = (modules ?? []).flatMap((m) =>
    [...(m.lessons ?? [])].sort((a, b) => a.position - b.position)
  );
  const completion = calculerCompletion(
    toutesLecons.filter((l) => terminees.has(l.id)).length,
    toutesLecons.length
  );
  const prochaine = toutesLecons.find((l) => !terminees.has(l.id));

  return (
    <div>
      <BackLink href="/formations">Mes formations</BackLink>
      <PageTitle>{formation.title}</PageTitle>

      <Card className="mb-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-48 flex-1">
            <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
              <div
                className="h-full rounded-full bg-brand-500"
                style={{ width: `${completion}%` }}
              />
            </div>
            <p className="mt-1 text-sm text-slate-500">
              {completion} % des leçons terminées
              {inscription.status === "completed" ? " — formation terminée 🎉" : ""}
            </p>
          </div>
          {prochaine ? (
            <Link
              href={`/formations/${formation.id}/lecon/${prochaine.id}`}
              className="inline-flex min-h-11 items-center rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
            >
              {completion === 0 ? "Commencer" : "Continuer"} : {prochaine.title}
            </Link>
          ) : null}
        </div>
      </Card>

      {!modules || modules.length === 0 ? (
        <EmptyState
          title="Contenu en préparation"
          hint="Les modules de cette formation ne sont pas encore disponibles."
        />
      ) : (
        <div className="space-y-4">
          {modules.map((m, i) => (
            <Card key={m.id}>
              <h2 className="font-semibold">
                Module {i + 1} — {m.title}
              </h2>
              <ul className="mt-3 space-y-2">
                {[...(m.lessons ?? [])]
                  .sort((a, b) => a.position - b.position)
                  .map((l) => (
                    <li key={l.id}>
                      <Link
                        href={`/formations/${formation.id}/lecon/${l.id}`}
                        className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2.5 text-sm transition hover:bg-brand-50"
                      >
                        <span className="flex items-center gap-2">
                          <span aria-hidden>
                            {terminees.has(l.id) ? "✅" : "⭕"}
                          </span>
                          {l.title}
                        </span>
                        <span className="flex items-center gap-2 text-xs text-slate-400">
                          {l.estimated_minutes ? `${l.estimated_minutes} min` : ""}
                          {terminees.has(l.id) ? <Badge>Terminée</Badge> : null}
                        </span>
                      </Link>
                    </li>
                  ))}
              </ul>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

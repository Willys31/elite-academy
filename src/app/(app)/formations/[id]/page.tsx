import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/profile";
import { calculerCompletion } from "@/lib/courses/progression";
import { donneAcces, peutSeDesinscrire } from "@/lib/courses/inscriptions";
import { seDesinscrireFormation } from "@/app/(app)/formations/actions";
import { DangerForm } from "@/components/ui/DangerForm";
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

  // Inscription requise pour suivre. Une inscription retirée ou
  // suspendue existe toujours en base : c'est son statut, pas sa
  // présence, qui ouvre le contenu.
  const { data: inscription } = await supabase
    .from("enrollments")
    .select("id, status, assigned_by")
    .eq("course_id", formation.id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!inscription || !donneAcces(inscription.status)) {
    redirect(`/catalogue/${formation.id}`);
  }
  const desinscription = peutSeDesinscrire({
    statut: inscription.status,
    assigneePar: inscription.assigned_by,
  });

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
                        <span className="flex min-w-0 items-center gap-2">
                          <span aria-hidden className="shrink-0">
                            {terminees.has(l.id) ? "✅" : "⭕"}
                          </span>
                          {l.title}
                        </span>
                        <span className="flex shrink-0 items-center gap-2 text-xs text-slate-400">
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

      {/* Désinscription : en dernier, sous le contenu. C'est un geste
          rare, qui ne doit pas concurrencer « Continuer ». */}
      {desinscription.ok ? (
        <Card className="mt-8 border-red-200">
          <h2 className="mb-2 font-semibold text-red-800">
            Se désinscrire de cette formation
          </h2>
          <p className="mb-3 text-sm text-slate-600">
            La formation disparaîtra de « Mes formations ». Vos leçons
            terminées et vos résultats de QCM sont conservés : si vous vous
            réinscrivez, vous reprendrez là où vous vous êtes arrêté.
          </p>
          <DangerForm
            action={seDesinscrireFormation}
            label="Se désinscrire"
            confirmLabel="Oui, me désinscrire"
            pendingLabel="Désinscription…"
            question={`Vous désinscrire de « ${formation.title} » ?`}
          >
            <input type="hidden" name="course_id" value={formation.id} />
          </DangerForm>
        </Card>
      ) : null}
    </div>
  );
}

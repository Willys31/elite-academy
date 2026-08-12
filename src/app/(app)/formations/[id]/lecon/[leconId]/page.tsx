import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/profile";
import { marquerLeconTerminee } from "@/app/(app)/formations/actions";
import { AuthForm } from "@/components/ui/AuthForm";
import { Badge, Card, PageTitle } from "@/components/ui";

export const metadata: Metadata = { title: "Leçon" };

/**
 * Lecteur de leçon (UX/UI §3.4) : contenu, activités (QCM),
 * marquage terminé, navigation précédent/suivant.
 */
export default async function LeconPage({
  params,
}: {
  params: Promise<{ id: string; leconId: string }>;
}) {
  const { id, leconId } = await params;
  const user = await getCurrentUser();
  if (!user) redirect("/connexion");

  const supabase = await createClient();
  const { data: formation } = await supabase
    .from("courses")
    .select("id, title, current_version_id")
    .eq("id", id)
    .maybeSingle();
  if (!formation) notFound();

  const { data: inscription } = await supabase
    .from("enrollments")
    .select("id")
    .eq("course_id", formation.id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!inscription) redirect(`/catalogue/${formation.id}`);

  const { data: lecon } = await supabase
    .from("lessons")
    .select("id, title, content, estimated_minutes, module_id, position")
    .eq("id", leconId)
    .maybeSingle();
  if (!lecon) notFound();

  // Navigation précédent / suivant sur l'ensemble ordonné des leçons.
  const { data: modules } = formation.current_version_id
    ? await supabase
        .from("modules")
        .select("id, position, lessons(id, title, position)")
        .eq("course_version_id", formation.current_version_id)
        .order("position")
    : { data: [] };
  const ordonnees = (modules ?? []).flatMap((m) =>
    [...(m.lessons ?? [])].sort((a, b) => a.position - b.position)
  );
  const index = ordonnees.findIndex((l) => l.id === lecon.id);
  const precedente = index > 0 ? ordonnees[index - 1] : null;
  const suivante = index >= 0 && index < ordonnees.length - 1 ? ordonnees[index + 1] : null;

  const [{ data: activites }, { data: progres }] = await Promise.all([
    supabase
      .from("activities")
      .select("id, type, title, difficulty")
      .eq("lesson_id", lecon.id)
      .order("position"),
    supabase
      .from("progress_records")
      .select("id")
      .eq("user_id", user.id)
      .eq("lesson_id", lecon.id)
      .maybeSingle(),
  ]);

  const contenu = (lecon.content ?? {}) as { text?: string };
  const terminee = Boolean(progres);

  return (
    <div className="mx-auto max-w-3xl">
      <p className="mb-2 text-sm">
        <Link href={`/formations/${formation.id}`} className="text-brand-600 hover:underline">
          ← {formation.title}
        </Link>
      </p>
      <PageTitle action={terminee ? <Badge>Terminée</Badge> : undefined}>
        {lecon.title}
      </PageTitle>

      <Card>
        {contenu.text ? (
          <div className="whitespace-pre-line text-[15px] leading-relaxed text-slate-800">
            {contenu.text}
          </div>
        ) : (
          <p className="text-sm text-slate-500">
            Cette leçon n&apos;a pas encore de contenu rédigé.
          </p>
        )}
      </Card>

      {activites && activites.length > 0 ? (
        <section aria-label="Activités" className="mt-6">
          <h2 className="mb-3 text-lg font-semibold">Activités de la leçon</h2>
          <div className="space-y-2">
            {activites.map((a) => (
              <Link
                key={a.id}
                href={`/formations/${formation.id}/activite/${a.id}`}
                className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm transition hover:border-brand-300"
              >
                <span>
                  {a.type === "quiz" ? "📝 QCM — " : ""}
                  {a.title}
                </span>
                <span className="text-xs text-slate-400">
                  Difficulté {a.difficulty}/5
                </span>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        {precedente ? (
          <Link
            href={`/formations/${formation.id}/lecon/${precedente.id}`}
            className="inline-flex min-h-11 items-center rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            ← Précédente
          </Link>
        ) : (
          <span />
        )}

        {!terminee ? (
          <AuthForm
            action={marquerLeconTerminee}
            submitLabel="Marquer comme terminée"
            pendingLabel="Enregistrement…"
          >
            <input type="hidden" name="course_id" value={formation.id} />
            <input type="hidden" name="lesson_id" value={lecon.id} />
          </AuthForm>
        ) : null}

        {suivante ? (
          <Link
            href={`/formations/${formation.id}/lecon/${suivante.id}`}
            className="inline-flex min-h-11 items-center rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
          >
            Suivante →
          </Link>
        ) : (
          <Link
            href={`/formations/${formation.id}`}
            className="inline-flex min-h-11 items-center rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
          >
            Retour au sommaire
          </Link>
        )}
      </div>
    </div>
  );
}

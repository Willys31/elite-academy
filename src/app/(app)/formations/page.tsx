import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/profile";
import { calculerCompletion } from "@/lib/courses/progression";
import { Badge, Card, EmptyState, PageTitle, SecondaryLink } from "@/components/ui";

export const metadata: Metadata = { title: "Mes formations" };

export default async function MesFormationsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/connexion");

  const supabase = await createClient();
  const { data: inscriptions } = await supabase
    .from("enrollments")
    .select(
      "id, status, started_at, completed_at, course:courses(id, title, description, current_version_id)"
    )
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  // Complétion par formation : leçons terminées / total.
  const { data: progres } = await supabase
    .from("progress_records")
    .select("course_id, lesson_id")
    .eq("user_id", user.id)
    .not("lesson_id", "is", null);

  const faitesParCours = new Map<string, number>();
  for (const p of progres ?? []) {
    faitesParCours.set(p.course_id, (faitesParCours.get(p.course_id) ?? 0) + 1);
  }

  const lignes = await Promise.all(
    (inscriptions ?? []).map(async (i) => {
      const course = Array.isArray(i.course) ? i.course[0] : i.course;
      if (!course) return null;
      let total = 0;
      if (course.current_version_id) {
        const { data: modules } = await supabase
          .from("modules")
          .select("id")
          .eq("course_version_id", course.current_version_id);
        const ids = (modules ?? []).map((m) => m.id);
        if (ids.length > 0) {
          const { count } = await supabase
            .from("lessons")
            .select("id", { count: "exact", head: true })
            .in("module_id", ids);
          total = count ?? 0;
        }
      }
      return {
        id: i.id,
        statut: i.status,
        course,
        completion: calculerCompletion(faitesParCours.get(course.id) ?? 0, total),
      };
    })
  );
  const inscriptionsAffichees = lignes.filter(Boolean) as NonNullable<
    (typeof lignes)[number]
  >[];

  return (
    <div>
      <PageTitle
        action={<SecondaryLink href="/catalogue">Parcourir le catalogue</SecondaryLink>}
      >
        Mes formations
      </PageTitle>

      {inscriptionsAffichees.length === 0 ? (
        <EmptyState
          title="Aucune formation en cours"
          hint="Inscrivez-vous à une formation publiée depuis le catalogue."
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {inscriptionsAffichees.map((l) => (
            <Link key={l.id} href={`/formations/${l.course.id}`}>
              <Card className="h-full transition hover:border-brand-300 hover:shadow">
                <div className="flex items-start justify-between gap-2 [&>:last-child]:shrink-0">
                  <h2 className="font-semibold">{l.course.title}</h2>
                  <Badge>
                    {l.statut === "completed" ? "Terminée" : "En cours"}
                  </Badge>
                </div>
                <div className="mt-3">
                  <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
                    <div
                      className="h-full rounded-full bg-brand-500"
                      style={{ width: `${l.completion}%` }}
                    />
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    {l.completion} % des leçons terminées
                  </p>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

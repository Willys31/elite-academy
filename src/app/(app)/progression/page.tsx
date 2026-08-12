import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/profile";
import { NIVEAU_CALCULE_LABELS } from "@/lib/courses/progression";
import { Badge, Card, EmptyState, PageTitle } from "@/components/ui";

export const metadata: Metadata = { title: "Ma progression" };

/**
 * Ma progression : maîtrise par compétence, formation par formation.
 * Rappel : le niveau est mesuré compétence par compétence ; le niveau
 * Elite n'est jamais attribué automatiquement.
 */
export default async function ProgressionPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/connexion");

  const supabase = await createClient();
  const { data: progres } = await supabase
    .from("progress_records")
    .select(
      "course_id, mastery_level, score, competency:competencies(name, domain), course:courses(id, title)"
    )
    .eq("user_id", user.id)
    .not("competency_id", "is", null)
    .order("updated_at", { ascending: false });

  // Regrouper par formation.
  const parCours = new Map<
    string,
    { titre: string; lignes: Array<{ nom: string; domaine: string; niveau: string | null; score: number | null }> }
  >();
  for (const p of progres ?? []) {
    const course = Array.isArray(p.course) ? p.course[0] : p.course;
    const comp = Array.isArray(p.competency) ? p.competency[0] : p.competency;
    if (!course || !comp) continue;
    if (!parCours.has(course.id)) {
      parCours.set(course.id, { titre: course.title, lignes: [] });
    }
    parCours.get(course.id)!.lignes.push({
      nom: comp.name,
      domaine: comp.domain ?? "",
      niveau: p.mastery_level,
      score: p.score === null ? null : Number(p.score),
    });
  }

  return (
    <div>
      <PageTitle>Ma progression</PageTitle>
      <p className="-mt-4 mb-6 text-sm text-slate-500">
        Votre maîtrise est suivie compétence par compétence, à partir de vos
        meilleurs résultats. Le niveau Elite ne peut être attribué que par un
        formateur ou un administrateur.
      </p>

      {parCours.size === 0 ? (
        <EmptyState
          title="Pas encore de résultats"
          hint="Réalisez les QCM de vos formations pour construire votre profil de compétences."
        />
      ) : (
        <div className="space-y-4">
          {[...parCours.entries()].map(([courseId, bloc]) => (
            <Card key={courseId}>
              <Link
                href={`/formations/${courseId}`}
                className="font-semibold text-slate-900 hover:text-brand-700"
              >
                {bloc.titre}
              </Link>
              <ul className="mt-3 space-y-2">
                {bloc.lignes.map((l, i) => (
                  <li
                    key={i}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm"
                  >
                    <span>
                      {l.nom}
                      {l.domaine ? (
                        <span className="ml-2 text-xs text-slate-400">{l.domaine}</span>
                      ) : null}
                    </span>
                    <span className="flex items-center gap-2">
                      {l.score !== null ? (
                        <span className="text-xs text-slate-500">{l.score} %</span>
                      ) : null}
                      {l.niveau ? (
                        <Badge>{NIVEAU_CALCULE_LABELS[l.niveau] ?? l.niveau}</Badge>
                      ) : (
                        <span className="text-xs text-slate-400">En cours d&apos;acquisition</span>
                      )}
                    </span>
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

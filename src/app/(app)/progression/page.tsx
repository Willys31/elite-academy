import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/profile";
import { NIVEAU_CALCULE_LABELS } from "@/lib/courses/progression";
import {
  Chiffre,
  CransMaitrise,
  EcranTitre,
  Etiquette,
  LienOr,
  Panneau,
  SectionTitre,
  Vide,
} from "@/components/app";

export const metadata: Metadata = { title: "Ma progression" };

/** Ordre d'affichage des niveaux dans la légende et le décompte. */
const NIVEAUX = ["fundamentals", "operational", "advanced", "elite"] as const;

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
    {
      titre: string;
      lignes: Array<{
        nom: string;
        domaine: string;
        niveau: string | null;
        score: number | null;
      }>;
    }
  >();
  const compteNiveaux: Record<string, number> = {};
  let enCoursAcquisition = 0;

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
    if (p.mastery_level) {
      compteNiveaux[p.mastery_level] = (compteNiveaux[p.mastery_level] ?? 0) + 1;
    } else {
      enCoursAcquisition += 1;
    }
  }

  const totalNiveaux = NIVEAUX.reduce(
    (n, niveau) => n + (compteNiveaux[niveau] ?? 0),
    0
  );

  return (
    <div>
      <EcranTitre
        eyebrow="Compétence par compétence"
        intro="Votre maîtrise est construite à partir de vos meilleurs résultats, jamais d'une moyenne générale. Le niveau Elite n'est attribué que par un formateur ou un administrateur."
      >
        Ma progression
      </EcranTitre>

      {parCours.size === 0 ? (
        <Vide
          titre="Pas encore de résultats"
          texte="Réalisez les QCM de vos formations : chaque compétence évaluée apparaîtra ici avec son niveau."
          action={<LienOr href="/formations">Aller à mes formations</LienOr>}
        />
      ) : (
        <>
          {/* Répartition : combien de compétences à chaque niveau. */}
          <dl className="grid grid-cols-2 gap-4 lg:grid-cols-5">
            {NIVEAUX.map((niveau) => (
              <Chiffre
                key={niveau}
                valeur={compteNiveaux[niveau] ?? 0}
                libelle={NIVEAU_CALCULE_LABELS[niveau]}
                detail={
                  niveau === "elite" ? "validation humaine" : "compétences"
                }
              />
            ))}
            <Chiffre
              valeur={enCoursAcquisition}
              libelle="En cours"
              detail="pas encore de niveau"
            />
          </dl>

          <p className="mt-3 text-xs text-slate-500">
            {totalNiveaux} compétence{totalNiveaux > 1 ? "s" : ""} avec un
            niveau attribué sur {totalNiveaux + enCoursAcquisition} évaluée
            {totalNiveaux + enCoursAcquisition > 1 ? "s" : ""}.
          </p>

          <div className="mt-8 space-y-6">
            {[...parCours.entries()].map(([courseId, bloc]) => (
              <section key={courseId}>
                <SectionTitre
                  compte={bloc.lignes.length}
                  action={
                    <Link
                      href={`/formations/${courseId}`}
                      className="text-sm font-medium text-brand-700 underline-offset-4 transition duration-200 hover:text-gold-600 hover:underline"
                    >
                      Ouvrir la formation
                    </Link>
                  }
                >
                  {bloc.titre}
                </SectionTitre>
                <Panneau flush>
                  <ul className="divide-y divide-sand-200">
                    {bloc.lignes.map((l, i) => (
                      <li
                        key={i}
                        className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-5 py-3.5"
                      >
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-ink-900">
                            {l.nom}
                          </p>
                          {l.domaine ? (
                            <p className="text-xs text-slate-400">{l.domaine}</p>
                          ) : null}
                        </div>
                        <div className="flex shrink-0 items-center gap-3">
                          {l.score !== null ? (
                            <span className="text-xs tabular-nums text-slate-500">
                              {l.score} %
                            </span>
                          ) : null}
                          {l.niveau ? (
                            <Etiquette ton={l.niveau === "elite" ? "or" : "neutre"}>
                              {NIVEAU_CALCULE_LABELS[l.niveau] ?? l.niveau}
                            </Etiquette>
                          ) : (
                            <span className="text-xs text-slate-400">
                              En cours d&apos;acquisition
                            </span>
                          )}
                          <CransMaitrise niveau={l.niveau} />
                        </div>
                      </li>
                    ))}
                  </ul>
                </Panneau>
              </section>
            ))}
          </div>

          {/* Légende : quatre crans, dont le dernier ne s'automatise pas. */}
          <Panneau className="mt-8">
            <SectionTitre>Comment lire les quatre crans</SectionTitre>
            <ul className="grid gap-3 sm:grid-cols-2">
              {[
                ["Fondamentaux", "comprendre et appliquer avec guidage"],
                ["Opérationnel", "agir seul en situation courante"],
                ["Avancé", "analyser et traiter la complexité"],
                ["Elite", "maîtriser, améliorer, transmettre"],
              ].map(([nom, detail], i) => (
                <li key={nom} className="flex items-center gap-3">
                  <CransMaitrise niveau={NIVEAUX[i]} />
                  <span className="min-w-0 text-sm">
                    <span className="font-medium text-ink-900">{nom}</span>
                    <span className="text-slate-500"> — {detail}</span>
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-4 border-l-2 border-gold-400 pl-4 text-sm leading-relaxed text-slate-600">
              Le quatrième cran ne s&apos;obtient jamais par le calcul. Il est
              accordé par un formateur ou un administrateur qui atteste que
              vous savez transmettre la compétence.
            </p>
          </Panneau>
        </>
      )}
    </div>
  );
}

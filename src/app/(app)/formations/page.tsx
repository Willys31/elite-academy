import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/profile";
import { calculerCompletion } from "@/lib/courses/progression";
import {
  ENROLLMENT_STATUS_LABELS,
  STATUTS_AVEC_ACCES,
} from "@/lib/courses/inscriptions";
import { Alert } from "@/components/ui";
import {
  EcranTitre,
  Etiquette,
  Jauge,
  LienOr,
  LienSobre,
  PanneauLien,
  SectionTitre,
  Vide,
} from "@/components/app";

export const metadata: Metadata = { title: "Mes formations" };

export default async function MesFormationsPage({
  searchParams,
}: {
  searchParams: Promise<{ desinscrit?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/connexion");
  const params = await searchParams;

  const supabase = await createClient();
  const { data: inscriptions } = await supabase
    .from("enrollments")
    .select(
      "id, status, started_at, completed_at, course:courses(id, title, description, current_version_id)"
    )
    .eq("user_id", user.id)
    // Les formations quittées sortent de la liste ; leur ligne reste en
    // base pour permettre la reprise (voir lib/courses/inscriptions).
    .in("status", [...STATUTS_AVEC_ACCES])
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
        faites: faitesParCours.get(course.id) ?? 0,
        total,
        completion: calculerCompletion(faitesParCours.get(course.id) ?? 0, total),
      };
    })
  );
  const affichees = lignes.filter(Boolean) as NonNullable<
    (typeof lignes)[number]
  >[];

  const enCours = affichees.filter((l) => l.statut !== "completed");
  const terminees = affichees.filter((l) => l.statut === "completed");

  return (
    <div>
      <EcranTitre
        eyebrow="Votre parcours"
        intro="Une formation est terminée quand toutes ses leçons le sont. Vous gardez l'accès à son contenu ensuite."
        action={<LienSobre href="/catalogue">Parcourir le catalogue</LienSobre>}
      >
        Mes formations
      </EcranTitre>

      {params.desinscrit ? (
        <div className="mb-6">
          <Alert kind="success">
            Vous êtes désinscrit. Votre progression est conservée : vous
            pouvez vous réinscrire à tout moment depuis la fiche de la
            formation.
          </Alert>
        </div>
      ) : null}

      {affichees.length === 0 ? (
        <Vide
          titre="Aucune formation en cours"
          texte="Inscrivez-vous à une formation publiée depuis le catalogue de votre organisation."
          action={<LienOr href="/catalogue">Parcourir le catalogue</LienOr>}
        />
      ) : (
        <>
          {enCours.length > 0 ? (
            <section>
              <SectionTitre compte={enCours.length}>En cours</SectionTitre>
              <GrilleFormations lignes={enCours} />
            </section>
          ) : null}

          {terminees.length > 0 ? (
            <section className={enCours.length > 0 ? "mt-10" : ""}>
              <SectionTitre compte={terminees.length}>Terminées</SectionTitre>
              <GrilleFormations lignes={terminees} />
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}

function GrilleFormations({
  lignes,
}: {
  lignes: Array<{
    id: string;
    statut: string;
    course: { id: string; title: string; description: string | null };
    faites: number;
    total: number;
    completion: number;
  }>;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {lignes.map((l) => (
        <PanneauLien key={l.id} href={`/formations/${l.course.id}`} className="flex h-full flex-col">
          <div className="flex items-start justify-between gap-3">
            <h3 className="min-w-0 font-display text-base font-semibold text-ink-900">
              {l.course.title}
            </h3>
            <Etiquette ton={l.statut === "completed" ? "or" : "neutre"}>
              {ENROLLMENT_STATUS_LABELS[l.statut] ?? l.statut}
            </Etiquette>
          </div>

          {l.course.description ? (
            <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-slate-500">
              {l.course.description}
            </p>
          ) : null}

          {/* `mt-auto` colle la jauge au bas de la carte : dans une grille,
              des descriptions de longueurs différentes désalignaient les
              barres d'une carte à l'autre. */}
          <div className="mt-auto pt-5">
            <Jauge
              pourcent={l.completion}
              libelle={
                l.total > 0
                  ? `${l.faites} / ${l.total} leçons · ${l.completion} %`
                  : "Contenu en préparation"
              }
            />
          </div>
        </PanneauLien>
      ))}
    </div>
  );
}

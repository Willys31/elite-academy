import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/profile";
import { STATUTS_AVEC_ACCES } from "@/lib/courses/inscriptions";
import { soumettreSituation } from "@/app/(app)/situations/actions";
import { FormulaireSituation } from "@/app/(app)/situations/FormulaireSituation";
import { Alert } from "@/components/ui";
import { EcranTitre, LienSobre, Panneau, Retour } from "@/components/app";

export const metadata: Metadata = { title: "Partager une situation de travail" };

/**
 * Soumission d'une situation (addendum §10.2) : template CSRR avec
 * compteurs, compétences de la formation, secteur, portée,
 * anonymisation, tags. Rien n'est publié avant validation.
 */
export default async function NouvelleSituationPage({
  searchParams,
}: {
  searchParams: Promise<{ formation?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/connexion");
  const params = await searchParams;

  const supabase = await createClient();
  const { data: inscriptions } = await supabase
    .from("enrollments")
    .select("course:courses(id, title, sector, organization:organizations(sector), course_competencies(competency:competencies(id, name)))")
    .eq("user_id", user.id)
    .in("status", [...STATUTS_AVEC_ACCES]);

  const premier = <T,>(v: T | T[] | null | undefined): T | null =>
    Array.isArray(v) ? (v[0] ?? null) : (v ?? null);

  const formations = (inscriptions ?? [])
    .map((i) => premier(i.course))
    .filter((c): c is NonNullable<typeof c> => Boolean(c))
    .map((c) => ({
      id: c.id as string,
      title: c.title as string,
      sector: (c.sector as string) ?? null,
      sectorOrganisation: (premier(c.organization)?.sector as string) ?? null,
      competences: ((c.course_competencies ?? []) as Array<{ competency: unknown }>)
        .map((cc) => premier(cc.competency) as { id: string; name: string } | null)
        .filter((k): k is { id: string; name: string } => Boolean(k)),
    }));

  return (
    <div className="mx-auto max-w-3xl">
      <Retour href="/situations" />
      <EcranTitre
        eyebrow="Situations de travail"
        intro="Racontez une situation réellement vécue, sans nom de client, de collègue ni chiffre confidentiel. Un formateur la relira avant publication."
      >
        Partager une situation
      </EcranTitre>

      {formations.length === 0 ? (
        <>
          <Alert kind="info">Une situation se rattache à une formation suivie : inscrivez-vous d&apos;abord à une formation.</Alert>
          <div className="mt-4"><LienSobre href="/catalogue">Parcourir le catalogue</LienSobre></div>
        </>
      ) : (
        <Panneau>
          <FormulaireSituation
            action={soumettreSituation}
            formations={formations}
            formationInitiale={params.formation ?? null}
            submitLabel="Soumettre pour validation"
          />
        </Panneau>
      )}
    </div>
  );
}

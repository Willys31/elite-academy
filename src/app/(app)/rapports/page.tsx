import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/profile";
import { activeMemberships, isEliteAdmin } from "@/lib/auth/roles";
import {
  parApprenant,
  parFormation,
  synthetiserOrganisation,
  type CertificatBrut,
  type InscriptionBrute,
} from "@/lib/rapports/rapports";
import { TableScroll } from "@/components/ui";
import {
  Chiffre,
  EcranTitre,
  Etiquette,
  Jauge,
  LienSobre,
  Panneau,
  Retour,
  SectionTitre,
  Vide,
} from "@/components/app";

export const metadata: Metadata = { title: "Rapports" };

/** Couleur d'un taux d'achèvement. Mêmes seuils que l'écran Résultats. */
function tonTaux(taux: number | null): "alerte" | "neutre" | "succes" | "or" {
  if (taux === null) return "neutre";
  if (taux < 30) return "alerte";
  if (taux < 60) return "neutre";
  if (taux < 90) return "succes";
  return "or";
}

/**
 * Rapports d'organisation.
 *
 * L'écran répond dans cet ordre à « où ça coince ? » puis « qui
 * décroche ? ». Formations et apprenants sont donc classés du taux
 * d'achèvement le plus faible au plus fort, pas alphabétiquement.
 *
 * Les désinscriptions sont comptées à part et sorties du taux : voir la
 * note en tête de src/lib/rapports/rapports.ts.
 */
export default async function RapportsPage({
  searchParams,
}: {
  searchParams: Promise<{ org?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/connexion");

  const params = await searchParams;
  const elite = isEliteAdmin(user.memberships);

  // Rendre compte d'une organisation suppose de l'encadrer.
  const encadrees = activeMemberships(user.memberships).filter((m) =>
    ["admin", "manager", "designer"].includes(m.role)
  );

  if (!elite && encadrees.length === 0) {
    return (
      <div>
        <Retour href="/accueil" />
        <EnTete />
        <Vide
          titre="Aucune organisation à suivre"
          texte="Les rapports sont réservés aux responsables et administrateurs d'organisation. Un formateur suit ses propres groupes depuis l'écran Résultats."
          action={<LienSobre href="/accueil">Retour au tableau de bord</LienSobre>}
        />
      </div>
    );
  }

  const supabase = await createClient();

  /* Un administrateur Elite Experience peut suivre n'importe quelle
     organisation ; on lui donne la liste complète plutôt que ses seules
     adhésions. Pour tous les autres, la RLS limite déjà la lecture. */
  const { data: toutesOrgs } = elite
    ? await supabase.from("organizations").select("id, name").order("name")
    : { data: null };

  const choisissables =
    toutesOrgs?.map((o) => ({ id: o.id, nom: o.name })) ??
    encadrees.map((m) => ({
      id: m.organization_id,
      nom: m.organization?.name ?? "Organisation",
    }));

  if (choisissables.length === 0) {
    return (
      <div>
        <Retour href="/accueil" />
        <EnTete />
        <Vide
          titre="Aucune organisation à suivre"
          texte="Aucune organisation ne relève de votre périmètre pour le moment."
          action={<LienSobre href="/organisations">Voir les organisations</LienSobre>}
        />
      </div>
    );
  }

  const orgId = choisissables.some((o) => o.id === params.org)
    ? (params.org as string)
    : choisissables[0].id;
  const orgNom = choisissables.find((o) => o.id === orgId)?.nom ?? "Organisation";

  const [{ data: inscriptions }, { data: certificats }] = await Promise.all([
    supabase
      .from("enrollments")
      .select("user_id, course_id, status, course:courses(title), profile:profiles(full_name, email)")
      .eq("organization_id", orgId),
    supabase
      .from("certificates")
      .select("user_id, course_id, status")
      .eq("organization_id", orgId),
  ]);

  const lignes = (inscriptions ?? []) as unknown as (InscriptionBrute & {
    course: { title: string } | { title: string }[] | null;
    profile: { full_name: string | null; email: string } | { full_name: string | null; email: string }[] | null;
  })[];
  const certs = (certificats ?? []) as CertificatBrut[];

  const titres = new Map<string, string>();
  const noms = new Map<string, string>();
  for (const l of lignes) {
    const c = Array.isArray(l.course) ? l.course[0] : l.course;
    if (c?.title) titres.set(l.course_id, c.title);
    const p = Array.isArray(l.profile) ? l.profile[0] : l.profile;
    if (p) noms.set(l.user_id, (p.full_name || "").trim() || p.email);
  }

  const brutes: InscriptionBrute[] = lignes.map((l) => ({
    user_id: l.user_id,
    course_id: l.course_id,
    status: l.status,
  }));

  const synthese = synthetiserOrganisation(brutes, certs);
  const formations = parFormation(brutes, certs, titres);
  const apprenants = parApprenant(brutes, certs, noms);

  return (
    <div>
      <Retour href="/accueil" />
      <EnTete organisation={choisissables.length > 1 ? undefined : orgNom} />

      {choisissables.length > 1 ? (
        <nav aria-label="Organisation suivie" className="mb-6 flex flex-wrap gap-2">
          {choisissables.map((o) => {
            const actif = o.id === orgId;
            return (
              <Link
                key={o.id}
                href={`/rapports?org=${o.id}`}
                aria-current={actif ? "page" : undefined}
                className={`inline-flex min-h-11 items-center rounded-xl border px-4 py-2 text-sm font-medium transition duration-200 ${
                  actif
                    ? "border-gold-400 bg-gold-300/15 text-ink-900"
                    : "border-sand-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-sand-50"
                }`}
              >
                {o.nom}
              </Link>
            );
          })}
        </nav>
      ) : null}

      {synthese.inscriptions === 0 && synthese.desinscriptions === 0 ? (
        <Vide
          titre={`Aucune inscription pour ${orgNom}`}
          texte="Les rapports se remplissent dès que des membres sont inscrits à une formation. Inscrivez-les depuis le catalogue ou la fiche de l'organisation."
          action={<LienSobre href="/catalogue">Ouvrir le catalogue</LienSobre>}
        />
      ) : (
        <>
          <dl className="mb-7 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
            <Chiffre valeur={synthese.apprenants} libelle="Apprenants" />
            <Chiffre
              valeur={synthese.inscriptions}
              libelle="Inscriptions"
              detail={
                synthese.desinscriptions > 0
                  ? `${synthese.desinscriptions} désinscription${synthese.desinscriptions > 1 ? "s" : ""} hors calcul`
                  : "Aucune désinscription"
              }
            />
            <Chiffre
              valeur={
                synthese.tauxAchevement === null ? "—" : `${synthese.tauxAchevement} %`
              }
              libelle="Achèvement"
              detail={`${synthese.achevees} formation${synthese.achevees > 1 ? "s" : ""} terminée${synthese.achevees > 1 ? "s" : ""}`}
            />
            <Chiffre
              valeur={synthese.certificats}
              libelle="Certificats"
              detail="Certificats valides"
            />
          </dl>

          <section aria-label="Par formation" className="mb-8">
            <SectionTitre compte={formations.length}>
              Par formation
            </SectionTitre>
            <p className="-mt-2 mb-4 text-sm text-slate-500">
              Les formations les moins abouties sont en tête : c&apos;est là que
              votre attention vaut le plus.
            </p>
            <Panneau flush>
              <TableScroll>
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="border-b border-sand-200 text-left">
                      <Th>Formation</Th>
                      <Th>Inscrits</Th>
                      <Th>En cours</Th>
                      <Th>Achevées</Th>
                      <Th>Certificats</Th>
                      <Th>Achèvement</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {formations.map((f) => (
                      <tr
                        key={f.courseId}
                        className="border-b border-sand-100 align-top last:border-0"
                      >
                        <td className="px-5 py-4">
                          <p className="font-medium text-ink-900">{f.titre}</p>
                          {f.desinscriptions > 0 ? (
                            <p className="mt-0.5 text-xs text-slate-500">
                              {f.desinscriptions} désinscription
                              {f.desinscriptions > 1 ? "s" : ""}
                            </p>
                          ) : null}
                        </td>
                        <Td>{f.inscrits}</Td>
                        <Td>{f.enCours}</Td>
                        <Td>{f.achevees}</Td>
                        <Td>{f.certificats}</Td>
                        <td className="min-w-[8rem] px-5 py-4">
                          <CelluleTaux taux={f.tauxAchevement} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableScroll>
            </Panneau>
          </section>

          <section aria-label="Par apprenant">
            <SectionTitre compte={apprenants.length}>Par apprenant</SectionTitre>
            <p className="-mt-2 mb-4 text-sm text-slate-500">
              Même classement : ceux qui avancent le moins apparaissent en
              premier.
            </p>
            <Panneau flush>
              <TableScroll>
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="border-b border-sand-200 text-left">
                      <Th>Apprenant</Th>
                      <Th>Inscriptions</Th>
                      <Th>En cours</Th>
                      <Th>Achevées</Th>
                      <Th>Certificats</Th>
                      <Th>Achèvement</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {apprenants.map((a) => (
                      <tr
                        key={a.userId}
                        className="border-b border-sand-100 align-top last:border-0"
                      >
                        <td className="px-5 py-4 font-medium text-ink-900">
                          {a.nom}
                        </td>
                        <Td>{a.inscriptions}</Td>
                        <Td>{a.enCours}</Td>
                        <Td>{a.achevees}</Td>
                        <Td>{a.certificats}</Td>
                        <td className="min-w-[8rem] px-5 py-4">
                          <CelluleTaux taux={a.tauxAchevement} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableScroll>
            </Panneau>
          </section>
        </>
      )}
    </div>
  );
}

function EnTete({ organisation }: { organisation?: string }) {
  return (
    <EcranTitre
      eyebrow={organisation ?? "Suivi d'organisation"}
      intro="Où en sont vos effectifs, formation par formation et personne par personne. Les désinscriptions sont comptées à part : quelqu'un qui se retire n'est pas un échec de la formation."
    >
      Rapports
    </EcranTitre>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="whitespace-nowrap px-5 py-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">
      {children}
    </th>
  );
}

function Td({ children }: { children: React.ReactNode }) {
  return (
    <td className="whitespace-nowrap px-5 py-4 tabular-nums text-slate-600">
      {children}
    </td>
  );
}

function CelluleTaux({ taux }: { taux: number | null }) {
  if (taux === null) {
    return (
      <span className="text-xs text-slate-400">
        Non mesurable
      </span>
    );
  }
  return (
    <div>
      <Etiquette ton={tonTaux(taux)}>{taux} %</Etiquette>
      <div className="mt-2">
        <Jauge pourcent={taux} />
      </div>
    </div>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/profile";
import {
  isEliteAdmin,
  ORG_TYPE_LABELS,
  ROLE_LABELS,
  type MemberRole,
  type OrgType,
} from "@/lib/auth/roles";
import {
  organisationChoisie,
  organisationsAdministrees,
  repartirParRole,
} from "@/lib/organisations/parametres";
import {
  ajouterMarque,
  archiverMarque,
  enregistrerOrganisation,
  reactiverMarque,
} from "@/app/(app)/parametres/actions";
import { AuthForm } from "@/components/ui/AuthForm";
import {
  Champ,
  EcranTitre,
  Etiquette,
  LienSobre,
  Panneau,
  Retour,
  Saisie,
  SectionTitre,
  Vide,
} from "@/components/app";

export const metadata: Metadata = { title: "Paramètres" };

interface Marque {
  id: string;
  name: string;
  description: string | null;
  status: string;
}

/**
 * Paramètres d'organisation.
 *
 * L'écran couvre ce qu'un administrateur règle une fois et oublie :
 * l'identité de l'organisation et ses marques. La gestion des membres
 * n'est pas reprise ici — elle vit dans la fiche de l'organisation, où
 * elle est déjà outillée ; la dupliquer donnerait deux endroits pour le
 * même geste et deux occasions de diverger.
 *
 * Les marques existaient en base depuis le premier lot sans aucune
 * interface : c'est le premier écran à les rendre utilisables.
 */
export default async function ParametresPage({
  searchParams,
}: {
  searchParams: Promise<{ org?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/connexion");

  const params = await searchParams;
  const administrees = organisationsAdministrees(user.memberships);
  const elite = isEliteAdmin(user.memberships);

  if (administrees.length === 0) {
    return (
      <div>
        <Retour href="/accueil" />
        <EnTete />
        <Vide
          titre="Aucune organisation à paramétrer"
          texte="Les paramètres sont réservés aux administrateurs d'organisation. Un responsable gère les membres depuis la fiche de son organisation, mais ne modifie pas l'organisation elle-même."
          action={<LienSobre href="/organisations">Voir les organisations</LienSobre>}
        />
      </div>
    );
  }

  const orgId = organisationChoisie(user.memberships, params.org);
  const supabase = await createClient();

  const [{ data: org }, { data: membres }, { data: marques }] = await Promise.all([
    supabase
      .from("organizations")
      .select("id, name, type, sector, status, created_at")
      .eq("id", orgId as string)
      .maybeSingle(),
    supabase
      .from("organization_members")
      .select("role, status")
      .eq("organization_id", orgId as string),
    supabase
      .from("brands")
      .select("id, name, description, status")
      .eq("organization_id", orgId as string)
      .order("name"),
  ]);

  if (!org) {
    return (
      <div>
        <Retour href="/accueil" />
        <EnTete />
        <Vide
          titre="Organisation introuvable"
          texte="Cette organisation n'existe plus ou n'est plus accessible avec vos droits actuels."
          action={<LienSobre href="/organisations">Voir les organisations</LienSobre>}
        />
      </div>
    );
  }

  const repartition = repartirParRole(
    (membres ?? []) as { role: MemberRole; status: string }[]
  );
  const toutesMarques = (marques ?? []) as Marque[];
  const actives = toutesMarques.filter((b) => b.status === "active");
  const archivees = toutesMarques.filter((b) => b.status !== "active");

  return (
    <div>
      <Retour href="/accueil" />
      <EnTete elite={elite} />

      {administrees.length > 1 ? (
        <nav aria-label="Organisation à paramétrer" className="mb-6 flex flex-wrap gap-2">
          {administrees.map((m) => {
            const actif = m.organization_id === org.id;
            return (
              <Link
                key={m.organization_id}
                href={`/parametres?org=${m.organization_id}`}
                aria-current={actif ? "page" : undefined}
                className={`inline-flex min-h-11 items-center rounded-xl border px-4 py-2 text-sm font-medium transition duration-200 ${
                  actif
                    ? "border-brand-600 bg-brand-50 text-ink-900"
                    : "border-sand-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-sand-50"
                }`}
              >
                {m.organization?.name ?? "Organisation"}
              </Link>
            );
          })}
        </nav>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[1.35fr_1fr]">
        <div className="space-y-6">
          <section aria-label="Identité de l'organisation">
            <SectionTitre>Identité</SectionTitre>
            <Panneau>
              <AuthForm
                action={enregistrerOrganisation}
                submitLabel="Enregistrer"
                pendingLabel="Enregistrement…"
                ton="sobre"
              >
                <input type="hidden" name="organization_id" value={org.id} />
                <div>
                  <Champ htmlFor="name">Nom de l&apos;organisation</Champ>
                  <Saisie
                    id="name"
                    name="name"
                    defaultValue={org.name}
                    maxLength={120}
                    required
                  />
                </div>
                <div>
                  <Champ htmlFor="sector" hint="Facultatif">
                    Secteur d&apos;activité
                  </Champ>
                  <Saisie
                    id="sector"
                    name="sector"
                    defaultValue={org.sector ?? ""}
                    placeholder="Banque, distribution, santé…"
                  />
                </div>
              </AuthForm>

              <p className="mt-4 border-t border-sand-100 pt-4 text-xs leading-relaxed text-slate-500">
                Le type d&apos;organisation (
                {ORG_TYPE_LABELS[org.type as OrgType] ?? org.type}) n&apos;est pas
                modifiable ici : il détermine les droits de tous ses membres.
                Un changement passe par Elite Experience.
              </p>
            </Panneau>
          </section>

          <section aria-label="Marques">
            <SectionTitre compte={actives.length}>Marques</SectionTitre>
            <Panneau className="mb-4">
              <p className="mb-4 text-sm leading-relaxed text-slate-600">
                Une marque distingue plusieurs enseignes au sein d&apos;une même
                organisation. Elle sert à rattacher formations et supports à la
                bonne enseigne.
              </p>
              <AuthForm
                action={ajouterMarque}
                submitLabel="Ajouter la marque"
                pendingLabel="Ajout…"
                ton="sobre"
              >
                <input type="hidden" name="organization_id" value={org.id} />
                <div>
                  <Champ htmlFor="marque-nom">Nom de la marque</Champ>
                  <Saisie id="marque-nom" name="name" required />
                </div>
                <div>
                  <Champ htmlFor="marque-desc" hint="Facultatif">
                    Description
                  </Champ>
                  <Saisie id="marque-desc" name="description" />
                </div>
              </AuthForm>
            </Panneau>

            {actives.length === 0 ? (
              <Vide
                titre="Aucune marque"
                texte="Cette organisation n'a pas encore de marque. Ajoutez-en une si vous distinguez plusieurs enseignes."
              />
            ) : (
              <ul className="space-y-3">
                {actives.map((b) => (
                  <li key={b.id}>
                    <Panneau>
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-medium text-ink-900">{b.name}</p>
                          {b.description ? (
                            <p className="mt-1 text-sm text-slate-600">
                              {b.description}
                            </p>
                          ) : null}
                        </div>
                        <div className="w-full sm:w-auto sm:min-w-[9rem]">
                          <AuthForm
                            action={archiverMarque}
                            submitLabel="Archiver"
                            pendingLabel="Archivage…"
                            ton="sobre"
                          >
                            <input
                              type="hidden"
                              name="organization_id"
                              value={org.id}
                            />
                            <input type="hidden" name="brand_id" value={b.id} />
                          </AuthForm>
                        </div>
                      </div>
                    </Panneau>
                  </li>
                ))}
              </ul>
            )}

            {archivees.length > 0 ? (
              <div className="mt-6">
                <SectionTitre compte={archivees.length}>Marques archivées</SectionTitre>
                <ul className="space-y-3">
                  {archivees.map((b) => (
                    <li key={b.id}>
                      <Panneau className="opacity-75">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div className="flex min-w-0 flex-wrap items-center gap-2">
                            <span className="font-medium text-ink-900">{b.name}</span>
                            <Etiquette>Archivée</Etiquette>
                          </div>
                          <div className="w-full sm:w-auto sm:min-w-[9rem]">
                            <AuthForm
                              action={reactiverMarque}
                              submitLabel="Réactiver"
                              pendingLabel="Réactivation…"
                              ton="sobre"
                            >
                              <input
                                type="hidden"
                                name="organization_id"
                                value={org.id}
                              />
                              <input type="hidden" name="brand_id" value={b.id} />
                            </AuthForm>
                          </div>
                        </div>
                      </Panneau>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </section>
        </div>

        <div className="space-y-6">
          <section aria-label="Effectifs">
            <SectionTitre>Effectifs</SectionTitre>
            <Panneau>
              {repartition.length === 0 ? (
                <p className="text-sm text-slate-500">
                  Aucun membre actif. Ajoutez-en depuis la fiche de
                  l&apos;organisation.
                </p>
              ) : (
                <ul className="space-y-2.5">
                  {repartition.map((r) => (
                    <li
                      key={r.role}
                      className="flex items-baseline justify-between gap-3 text-sm"
                    >
                      <span className="text-slate-600">{ROLE_LABELS[r.role]}</span>
                      <span className="font-display text-lg font-semibold text-ink-900">
                        {r.membres}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <div className="mt-4 border-t border-sand-100 pt-4">
                <LienSobre href={`/organisations/${org.id}`}>
                  Gérer les membres
                </LienSobre>
              </div>
            </Panneau>
          </section>

          <section aria-label="Qui peut quoi">
            <SectionTitre>Qui peut quoi</SectionTitre>
            <Panneau>
              <dl className="space-y-3 text-sm">
                <Droit role="admin">
                  Paramètre l&apos;organisation, gère les membres et les marques,
                  publie les formations.
                </Droit>
                <Droit role="designer">
                  Conçoit et modifie les formations, soumet à validation. Ne
                  publie pas.
                </Droit>
                <Droit role="trainer">
                  Crée ses propres formations, anime les sessions, suit les
                  résultats de ses groupes.
                </Droit>
                <Droit role="manager">
                  Inscrit et retire des membres, consulte les rapports. Ne
                  modifie pas l&apos;organisation.
                </Droit>
                <Droit role="learner">
                  Suit les formations auxquelles il est inscrit.
                </Droit>
              </dl>
              <p className="mt-4 border-t border-sand-100 pt-4 text-xs leading-relaxed text-slate-500">
                Ces droits sont appliqués par la base de données, pas seulement
                par l&apos;interface : une action refusée le reste même si
                l&apos;écran la propose par erreur.
              </p>
            </Panneau>
          </section>
        </div>
      </div>
    </div>
  );
}

function EnTete({ elite = false }: { elite?: boolean }) {
  return (
    <EcranTitre
      eyebrow="Administration"
      intro={
        elite
          ? "Identité et marques des organisations que vous administrez. Les membres se gèrent depuis la fiche de chaque organisation."
          : "Identité et marques de votre organisation. Les membres se gèrent depuis sa fiche."
      }
    >
      Paramètres
    </EcranTitre>
  );
}

function Droit({
  role,
  children,
}: {
  role: MemberRole;
  children: React.ReactNode;
}) {
  return (
    <div>
      <dt className="font-medium text-ink-900">{ROLE_LABELS[role]}</dt>
      <dd className="mt-0.5 text-xs leading-relaxed text-slate-600">{children}</dd>
    </div>
  );
}

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/profile";
import {
  activeMemberships,
  isEliteAdmin,
  ORG_TYPE_LABELS,
  ROLE_LABELS,
  type MemberRole,
  type OrgType,
} from "@/lib/auth/roles";
import {
  construireAnnuaire,
  filtrerAnnuaire,
  synthetiserAnnuaire,
  type AdhesionBrute,
  type LigneAnnuaire,
  type OrganisationBrute,
  type ProfilBrut,
} from "@/lib/utilisateurs/annuaire";
import { TableScroll } from "@/components/ui";
import {
  Chiffre,
  EcranTitre,
  Etiquette,
  LienSobre,
  Panneau,
  Retour,
  SectionTitre,
  Vide,
} from "@/components/app";

export const metadata: Metadata = { title: "Utilisateurs" };

const ROLES: MemberRole[] = ["admin", "designer", "trainer", "manager", "learner"];

/**
 * Annuaire des comptes.
 *
 * Écran de lecture : il répond à « qui est sur la plateforme, et à quel
 * titre ? ». Les actions d'administration (changer un rôle, suspendre)
 * restent dans la fiche de chaque organisation, où le geste a un
 * périmètre clair — un même compte peut tenir des rôles différents dans
 * plusieurs organisations, et « changer son rôle » n'y voudrait rien dire.
 *
 * Le périmètre affiché n'est pas décidé ici mais par la RLS : un
 * administrateur Elite Experience lit tous les profils, un
 * responsable lit les membres de ses organisations, un compte sans
 * responsabilité ne lit que lui-même. L'écran se contente donc de
 * présenter ce qui est revenu, et d'expliquer quand c'est vide.
 */
export default async function UtilisateursPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    role?: string;
    org?: string;
    statut?: string;
  }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/connexion");

  const params = await searchParams;
  const elite = isEliteAdmin(user.memberships);
  const encadre = activeMemberships(user.memberships).some(
    (m) => m.role === "admin" || m.role === "manager"
  );

  if (!elite && !encadre) {
    return (
      <div>
        <Retour href="/accueil" />
        <EnTete />
        <Vide
          titre="Annuaire réservé à l'encadrement"
          texte="Seuls les administrateurs Elite Experience et les responsables d'organisation consultent l'annuaire des comptes. Si vous pensez qu'il s'agit d'une erreur, demandez la vérification de votre rôle."
          action={<LienSobre href="/accueil">Retour au tableau de bord</LienSobre>}
        />
      </div>
    );
  }

  const supabase = await createClient();

  /* Trois lectures séparées plutôt qu'une jointure : voir la note en
     tête de src/lib/utilisateurs/annuaire.ts. Un compte créé mais jamais
     rattaché n'apparaîtrait pas dans une jointure partant des adhésions,
     alors que c'est exactement ce qu'un administrateur doit repérer. */
  const [{ data: profils }, { data: adhesions }, { data: organisations }] =
    await Promise.all([
      supabase
        .from("profiles")
        .select("id, full_name, email, status, created_at")
        .order("full_name"),
      supabase
        .from("organization_members")
        .select("user_id, organization_id, role, status"),
      supabase.from("organizations").select("id, name, type").order("name"),
    ]);

  const orgs = (organisations ?? []) as OrganisationBrute[];
  const annuaire = construireAnnuaire(
    (profils ?? []) as ProfilBrut[],
    (adhesions ?? []) as AdhesionBrute[],
    orgs
  );
  const synthese = synthetiserAnnuaire(annuaire);

  const filtres = {
    recherche: params.q ?? "",
    role: (ROLES.includes(params.role as MemberRole)
      ? (params.role as MemberRole)
      : "") as MemberRole | "",
    organisation: params.org ?? "",
    statut: (["actif", "suspendu", "orphelin"].includes(params.statut ?? "")
      ? params.statut
      : "") as "actif" | "suspendu" | "orphelin" | "",
  };
  const filtre = Object.values(filtres).some(Boolean);
  const lignes = filtrerAnnuaire(annuaire, filtres);

  if (annuaire.length === 0) {
    return (
      <div>
        <Retour href="/accueil" />
        <EnTete />
        <Vide
          titre="Aucun compte visible"
          texte="Aucun compte ne relève de votre périmètre pour le moment. Les comptes apparaissent ici dès qu'ils rejoignent une organisation que vous administrez."
          action={<LienSobre href="/organisations">Voir les organisations</LienSobre>}
        />
      </div>
    );
  }

  return (
    <div>
      <Retour href="/accueil" />
      <EnTete elite={elite} />

      <dl className="mb-7 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <Chiffre valeur={synthese.comptes} libelle="Comptes" />
        <Chiffre
          valeur={synthese.actifs}
          libelle="Actifs"
          detail={
            synthese.comptes - synthese.actifs > 0
              ? `${synthese.comptes - synthese.actifs} suspendu${synthese.comptes - synthese.actifs > 1 ? "s" : ""}`
              : "Aucun compte suspendu"
          }
        />
        <Chiffre
          valeur={synthese.orphelins}
          libelle="Sans rattachement"
          detail="Ces comptes ne peuvent rien faire"
        />
        <Chiffre
          valeur={synthese.organisations}
          libelle="Organisations"
          href="/organisations"
        />
      </dl>

      <Panneau className="mb-6">
        <form method="get" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <div className="lg:col-span-2">
            <label
              htmlFor="q"
              className="mb-1.5 block text-sm font-medium text-ink-900"
            >
              Nom ou e-mail
            </label>
            <input
              id="q"
              name="q"
              type="search"
              defaultValue={filtres.recherche}
              placeholder="Koné, w.yao@…"
              className="block min-h-11 w-full rounded-xl border border-sand-200 bg-sand-50/60 px-3.5 py-2.5 text-base text-ink-900 outline-none transition duration-200 placeholder:text-slate-400 hover:bg-white focus:border-gold-400 focus:bg-white focus:ring-4 focus:ring-gold-300/25 sm:text-sm"
            />
          </div>

          <ChampSelect id="role" label="Rôle" valeur={filtres.role}>
            <option value="">Tous les rôles</option>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </ChampSelect>

          <ChampSelect id="org" label="Organisation" valeur={filtres.organisation}>
            <option value="">Toutes</option>
            {orgs.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </ChampSelect>

          <ChampSelect id="statut" label="Statut" valeur={filtres.statut}>
            <option value="">Tous</option>
            <option value="actif">Compte actif</option>
            <option value="suspendu">Compte suspendu</option>
            <option value="orphelin">Sans rattachement actif</option>
          </ChampSelect>

          <div className="flex flex-wrap items-end gap-2 sm:col-span-2 lg:col-span-5">
            <button
              type="submit"
              className="inline-flex min-h-11 items-center justify-center rounded-xl bg-gold-400 px-4 py-2.5 text-sm font-semibold text-ink-950 shadow-[0_6px_18px_-6px_rgba(211,160,50,0.6)] transition duration-200 hover:bg-gold-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:ring-offset-2"
            >
              Filtrer
            </button>
            {filtre ? (
              <LienSobre href="/utilisateurs">Réinitialiser</LienSobre>
            ) : null}
          </div>
        </form>
      </Panneau>

      <SectionTitre compte={lignes.length}>
        {filtre ? "Comptes correspondants" : "Tous les comptes"}
      </SectionTitre>

      {lignes.length === 0 ? (
        <Vide
          titre="Aucun compte ne correspond"
          texte="Aucun compte de votre périmètre ne répond à ces critères. Élargissez la recherche ou réinitialisez les filtres."
          action={<LienSobre href="/utilisateurs">Réinitialiser les filtres</LienSobre>}
        />
      ) : (
        <Panneau flush>
          <TableScroll>
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-sand-200 text-left">
                  <Th>Compte</Th>
                  <Th>Rôles</Th>
                  <Th>Organisations</Th>
                  <Th>Statut</Th>
                </tr>
              </thead>
              <tbody>
                {lignes.map((l) => (
                  <LigneCompte key={l.id} ligne={l} />
                ))}
              </tbody>
            </table>
          </TableScroll>
        </Panneau>
      )}
    </div>
  );
}

function EnTete({ elite = false }: { elite?: boolean }) {
  return (
    <EcranTitre
      eyebrow="Administration"
      intro={
        elite
          ? "Tous les comptes de la plateforme, leurs rattachements et les rôles qu'ils exercent. Les changements de rôle se font dans la fiche de l'organisation concernée, car un même compte peut tenir des rôles différents selon l'organisation."
          : "Les comptes des organisations que vous encadrez, et les rôles qu'ils y exercent."
      }
    >
      Utilisateurs
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

function ChampSelect({
  id,
  label,
  valeur,
  children,
}: {
  id: string;
  label: string;
  valeur: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-ink-900">
        {label}
      </label>
      <select
        id={id}
        name={id}
        defaultValue={valeur}
        className="block min-h-11 w-full rounded-xl border border-sand-200 bg-sand-50/60 px-3.5 py-2.5 text-base text-ink-900 outline-none transition duration-200 hover:bg-white focus:border-gold-400 focus:bg-white focus:ring-4 focus:ring-gold-300/25 sm:text-sm"
      >
        {children}
      </select>
    </div>
  );
}

function LigneCompte({ ligne }: { ligne: LigneAnnuaire }) {
  return (
    <tr className="border-b border-sand-100 last:border-0 align-top">
      {/* Nom et adresse ne se coupent pas : une adresse fendue en
          « i.ba@ecole. ci » n'est plus lisible ni copiable. La largeur
          manquante est prise en charge par le défilement horizontal du
          tableau, qui existe pour ça. */}
      <td className="whitespace-nowrap px-5 py-4">
        <p className="font-medium text-ink-900">
          {ligne.nom || <span className="text-slate-400">Nom non renseigné</span>}
        </p>
        <p className="mt-0.5 text-xs text-slate-500">{ligne.email}</p>
      </td>

      <td className="px-5 py-4">
        {ligne.roles.length === 0 ? (
          <span className="text-xs text-slate-400">Aucun rôle exercé</span>
        ) : (
          <span className="flex flex-wrap gap-1.5">
            {ligne.roles.map((r) => (
              <Etiquette key={r} ton={r === "admin" ? "or" : "neutre"}>
                {ROLE_LABELS[r]}
              </Etiquette>
            ))}
          </span>
        )}
      </td>

      <td className="px-5 py-4">
        {ligne.adhesions.length === 0 ? (
          <span className="text-xs text-slate-400">Aucune</span>
        ) : (
          <ul className="space-y-1">
            {ligne.adhesions.map((a) => (
              <li key={a.organisationId} className="text-xs text-slate-600">
                {a.organisation}
                {a.type ? (
                  <span className="text-slate-400">
                    {" "}
                    · {ORG_TYPE_LABELS[a.type as OrgType] ?? a.type}
                  </span>
                ) : null}
                {!a.actif ? (
                  <span className="ml-1.5 text-red-600">(suspendue)</span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </td>

      <td className="px-5 py-4">
        <span className="flex flex-wrap gap-1.5">
          <Etiquette ton={ligne.actif ? "succes" : "alerte"}>
            {ligne.actif ? "Actif" : "Suspendu"}
          </Etiquette>
          {ligne.orphelin ? (
            <Etiquette ton="alerte">Sans rattachement</Etiquette>
          ) : null}
        </span>
      </td>
    </tr>
  );
}

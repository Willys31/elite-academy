import {
  activeMemberships,
  isEliteAdmin,
  type Membership,
  type MemberRole,
} from "@/lib/auth/roles";

/**
 * Droits de l'écran Paramètres — logique pure, testable unitairement.
 *
 * Distinction importante : administrer une organisation (en changer le
 * nom, gérer ses marques) est réservé au rôle `admin`, alors que gérer
 * ses membres est aussi ouvert au rôle `manager`. Un responsable
 * d'organisation inscrit et retire des gens ; il ne renomme pas
 * l'organisation. C'est ce que disent déjà les politiques RLS
 * `organizations_update` et `brands_*` ; ce module les reflète côté
 * interface pour ne pas proposer un geste que la base refusera.
 */

/** Peut modifier l'organisation elle-même et ses marques. */
export function peutAdministrerOrganisation(
  memberships: Membership[],
  organizationId: string
): boolean {
  if (isEliteAdmin(memberships)) return true;
  return activeMemberships(memberships).some(
    (m) => m.organization_id === organizationId && m.role === "admin"
  );
}

/** Organisations que l'utilisateur peut administrer, triées par nom. */
export function organisationsAdministrees(
  memberships: Membership[]
): Membership[] {
  return activeMemberships(memberships)
    .filter((m) => m.role === "admin")
    .sort((a, b) =>
      (a.organization?.name ?? "").localeCompare(b.organization?.name ?? "", "fr")
    );
}

/**
 * Organisation à afficher par défaut sur l'écran.
 *
 * `demandee` vient de l'URL : on ne la retient que si elle fait partie
 * des organisations administrées, sinon un identifiant collé à la main
 * afficherait un formulaire d'édition pour une organisation que la base
 * refusera d'enregistrer.
 */
export function organisationChoisie(
  memberships: Membership[],
  demandee?: string
): string | null {
  const administrees = organisationsAdministrees(memberships);
  if (demandee && administrees.some((m) => m.organization_id === demandee)) {
    return demandee;
  }
  return administrees[0]?.organization_id ?? null;
}

export interface RepartitionRoles {
  role: MemberRole;
  membres: number;
}

/** Répartition des membres actifs par rôle, du rôle le plus fort au plus faible. */
const ORDRE_ROLES: MemberRole[] = [
  "admin",
  "designer",
  "trainer",
  "manager",
  "learner",
];

export function repartirParRole(
  membres: { role: MemberRole; status: string }[]
): RepartitionRoles[] {
  const actifs = membres.filter((m) => m.status === "active");
  return ORDRE_ROLES.map((role) => ({
    role,
    membres: actifs.filter((m) => m.role === role).length,
  })).filter((r) => r.membres > 0);
}

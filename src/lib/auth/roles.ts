/**
 * Rôles et permissions – logique pure, testable unitairement.
 *
 * Rappel PRD (§4) : administrateur Elite Experience, concepteur ou
 * expert pédagogique, formateur, responsable d'organisation, apprenant.
 *
 * Cette logique est un confort d'interface : la sécurité réelle est
 * appliquée par les politiques RLS et les vérifications serveur.
 */

export type MemberRole = "admin" | "designer" | "trainer" | "manager" | "learner";

export type OrgType =
  | "entreprise"
  | "ecole"
  | "centre_formation"
  | "institution"
  | "elite_experience";

export interface Membership {
  organization_id: string;
  role: MemberRole;
  status: string;
  organization?: {
    id: string;
    name: string;
    type: OrgType;
  } | null;
}

export const ROLE_LABELS: Record<MemberRole, string> = {
  admin: "Administrateur",
  designer: "Concepteur pédagogique",
  trainer: "Formateur",
  manager: "Responsable d'organisation",
  learner: "Apprenant",
};

export const ORG_TYPE_LABELS: Record<OrgType, string> = {
  entreprise: "Entreprise",
  ecole: "École ou université",
  centre_formation: "Centre de formation",
  institution: "Institution publique",
  elite_experience: "Elite Experience",
};

/** Adhésions actives uniquement. */
export function activeMemberships(memberships: Membership[]): Membership[] {
  return memberships.filter((m) => m.status === "active");
}

/** L'utilisateur est-il administrateur Elite Experience ? */
export function isEliteAdmin(memberships: Membership[]): boolean {
  return activeMemberships(memberships).some(
    (m) => m.role === "admin" && m.organization?.type === "elite_experience"
  );
}

/** L'utilisateur possède-t-il l'un des rôles donnés (toutes organisations) ? */
export function hasAnyRole(
  memberships: Membership[],
  roles: MemberRole[]
): boolean {
  return activeMemberships(memberships).some((m) => roles.includes(m.role));
}

/**
 * Rôle « principal » pour choisir la navigation affichée.
 * Priorité : admin > designer > trainer > manager > learner.
 */
const ROLE_PRIORITY: MemberRole[] = [
  "admin",
  "designer",
  "trainer",
  "manager",
  "learner",
];

export function primaryRole(memberships: Membership[]): MemberRole {
  const active = activeMemberships(memberships);
  for (const role of ROLE_PRIORITY) {
    if (active.some((m) => m.role === role)) return role;
  }
  return "learner";
}

/** Élément de navigation. */
export interface NavItem {
  label: string;
  href: string;
}

/**
 * Navigation principale par rôle
 * (référence : elite_academy_ux_ui_parcours_final.md §2).
 * Les écrans non couverts par le lot en cours pointent vers des
 * pages « à venir » clairement identifiées.
 */
export function navigationFor(role: MemberRole): NavItem[] {
  switch (role) {
    case "admin":
    case "designer":
      return [
        { label: "Vue générale", href: "/accueil" },
        { label: "Organisations", href: "/organisations" },
        { label: "Catalogue", href: "/catalogue" },
        { label: "Compétences", href: "/competences" },
        { label: "Sources", href: "/sources" },
        { label: "Validation", href: "/validation" },
        { label: "Utilisateurs", href: "/utilisateurs" },
        { label: "Paramètres", href: "/parametres" },
      ];
    case "trainer":
      return [
        { label: "Tableau de bord", href: "/accueil" },
        { label: "Mes groupes", href: "/groupes" },
        { label: "Mes sessions", href: "/sessions" },
        { label: "Mes formations", href: "/formations" },
        { label: "Résultats", href: "/resultats" },
        { label: "Profil", href: "/profil" },
      ];
    case "manager":
      return [
        { label: "Tableau de bord", href: "/accueil" },
        { label: "Mon organisation", href: "/organisations" },
        { label: "Parcours attribués", href: "/formations" },
        { label: "Rapports", href: "/rapports" },
        { label: "Profil", href: "/profil" },
      ];
    case "learner":
    default:
      return [
        { label: "Accueil", href: "/accueil" },
        { label: "Catalogue", href: "/catalogue" },
        { label: "Mes formations", href: "/formations" },
        { label: "Ma progression", href: "/progression" },
        { label: "Ma révision", href: "/revision" },
        { label: "Mes certificats", href: "/certificats" },
        { label: "Mon profil", href: "/profil" },
      ];
  }
}

/** Peut créer une organisation (interface). RLS revérifie côté base. */
export function canCreateOrganization(memberships: Membership[]): boolean {
  return isEliteAdmin(memberships);
}

/** Peut gérer les membres d'une organisation donnée (interface). */
export function canManageMembers(
  memberships: Membership[],
  organizationId: string
): boolean {
  if (isEliteAdmin(memberships)) return true;
  return activeMemberships(memberships).some(
    (m) =>
      m.organization_id === organizationId &&
      (m.role === "admin" || m.role === "manager")
  );
}

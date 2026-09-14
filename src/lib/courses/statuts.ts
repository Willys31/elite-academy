/**
 * Cycle de statuts des formations – logique pure, testable.
 *
 * Cycle (PRD §6.3, architecture §9) :
 *   brouillon → en attente de validation → validé → publié → archivé
 * avec retour possible en brouillon lors d'une demande de corrections.
 *
 * La sécurité réelle est appliquée par RLS et par les actions serveur ;
 * ce module décrit les règles métier et alimente l'interface.
 */

import type { MemberRole, Membership } from "@/lib/auth/roles";
import { activeMemberships, isEliteAdmin } from "@/lib/auth/roles";

export type CourseStatus =
  | "draft"
  | "review"
  | "approved"
  | "published"
  | "archived";

export const STATUS_LABELS: Record<CourseStatus, string> = {
  draft: "Brouillon",
  review: "En attente de validation",
  approved: "Validé",
  published: "Publié",
  archived: "Archivé",
};

export const LEVEL_LABELS: Record<string, string> = {
  fundamentals: "Fondamentaux",
  operational: "Opérationnel",
  advanced: "Avancé",
  elite: "Elite",
};

export const CONTEXT_LABELS: Record<string, string> = {
  generic: "Générique",
  sector: "Sectoriel",
  organization: "Entreprise",
  brand: "Marque",
  confidential: "Confidentiel",
};

export const FORMAT_LABELS: Record<string, string> = {
  online: "En ligne",
  in_person: "Présentiel",
  hybrid: "Hybride",
};

/**
 * Rôles autorisés pour chaque transition, au sein de l'organisation
 * de la formation. L'admin Elite Experience peut tout faire.
 * La validation (review → approved) et la publication restent
 * réservées aux administrateurs, conformément au PRD (§22 :
 * « un administrateur peut valider ou rejeter le brouillon »).
 */
const TRANSITIONS: Record<string, MemberRole[]> = {
  /* Le formateur peut soumettre à validation depuis la migration 0010,
     puisqu'il peut désormais concevoir. Sans cette ouverture, une
     formation créée par un formateur resterait bloquée en brouillon,
     faute de pouvoir la présenter à qui que ce soit. La suite du cycle
     ne bouge pas : approuver et publier restent à l'administrateur. */
  "draft->review": ["admin", "designer", "trainer"],
  "review->approved": ["admin"],
  "review->draft": ["admin"], // demande de corrections
  "approved->published": ["admin"],
  "approved->draft": ["admin", "designer"], // reprendre la conception
  "published->archived": ["admin"],
  "draft->archived": ["admin"],
  "archived->draft": ["admin"], // réactiver pour retravailler
};

/** Rôle effectif de l'utilisateur dans une organisation donnée. */
export function roleInOrg(
  memberships: Membership[],
  organizationId: string
): MemberRole | null {
  const m = activeMemberships(memberships).find(
    (x) => x.organization_id === organizationId
  );
  return m?.role ?? null;
}

/** La transition est-elle autorisée pour cet utilisateur ? */
export function canTransition(
  memberships: Membership[],
  organizationId: string,
  from: CourseStatus,
  to: CourseStatus
): boolean {
  const allowed = TRANSITIONS[`${from}->${to}`];
  if (!allowed) return false;
  if (isEliteAdmin(memberships)) return true;
  const role = roleInOrg(memberships, organizationId);
  return role !== null && allowed.includes(role);
}

/** Transitions proposables à l'utilisateur depuis un statut donné. */
export function availableTransitions(
  memberships: Membership[],
  organizationId: string,
  from: CourseStatus
): CourseStatus[] {
  return (Object.keys(TRANSITIONS) as string[])
    .filter((k) => k.startsWith(`${from}->`))
    .map((k) => k.split("->")[1] as CourseStatus)
    .filter((to) => canTransition(memberships, organizationId, from, to));
}

/** Libellé d'action en français pour une transition. */
export function transitionLabel(from: CourseStatus, to: CourseStatus): string {
  const labels: Record<string, string> = {
    "draft->review": "Soumettre à validation",
    "review->approved": "Approuver",
    "review->draft": "Demander des corrections",
    "approved->published": "Publier",
    "approved->draft": "Repasser en brouillon",
    "published->archived": "Archiver",
    "draft->archived": "Archiver",
    "archived->draft": "Réactiver en brouillon",
  };
  return labels[`${from}->${to}`] ?? `${STATUS_LABELS[from]} → ${STATUS_LABELS[to]}`;
}

/**
 * Le contenu (titre, modules, leçons, compétences) est-il modifiable ?
 * Uniquement en brouillon : toute modification après validation doit
 * repasser par le cycle (pas de modification silencieuse d'un contenu
 * validé ou publié).
 */
export function isContentEditable(status: CourseStatus): boolean {
  return status === "draft";
}

/**
 * Peut créer une formation dans une organisation donnée.
 *
 * Le formateur a rejoint la liste (migration 0010) : chez Elite
 * Experience, il conçoit souvent lui-même ce qu'il anime. Il devient
 * propriétaire de ce qu'il crée, donc `can_edit_course` l'autorise à le
 * modifier. Créer n'est pas publier : la publication reste à
 * l'administrateur, via les transitions de statut.
 */
export function canCreateCourse(
  memberships: Membership[],
  organizationId: string
): boolean {
  if (isEliteAdmin(memberships)) return true;
  const role = roleInOrg(memberships, organizationId);
  return role === "admin" || role === "designer" || role === "trainer";
}

/**
 * Peut supprimer définitivement une formation.
 *
 * Volontairement plus restrictif que la création : un concepteur crée
 * et modifie, seul un administrateur détruit. Ce test reproduit la
 * politique RLS `courses_delete` — il ne fait que masquer un bouton,
 * la base reste seule juge.
 */
export function canDeleteCourse(
  memberships: Membership[],
  organizationId: string
): boolean {
  if (isEliteAdmin(memberships)) return true;
  return roleInOrg(memberships, organizationId) === "admin";
}

/**
 * Organisations dans lesquelles l'utilisateur peut créer une formation.
 * Même liste de rôles que `canCreateCourse` — les deux doivent rester
 * alignées, sinon l'interface propose un bouton que la base refuse.
 */
export function organizationsForCourseCreation(
  memberships: Membership[]
): Membership[] {
  return activeMemberships(memberships).filter(
    (m) => m.role === "admin" || m.role === "designer" || m.role === "trainer"
  );
}

/** Peut gérer le référentiel de compétences d'une organisation. */
export function canManageCompetencies(
  memberships: Membership[],
  organizationId: string | null
): boolean {
  if (isEliteAdmin(memberships)) return true;
  if (organizationId === null) return false; // globales : Elite Experience
  const role = roleInOrg(memberships, organizationId);
  return role === "admin" || role === "designer";
}

/** Génère un slug lisible à partir d'un titre. */
export function slugify(title: string): string {
  return title
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // retire les accents
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "formation";
}

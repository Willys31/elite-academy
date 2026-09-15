import type { MemberRole, OrgType } from "@/lib/auth/roles";

/**
 * Annuaire des comptes — logique pure, testable unitairement.
 *
 * L'écran /utilisateurs assemble deux lectures distinctes plutôt qu'une
 * jointure : les profils d'un côté, les adhésions de l'autre. C'est
 * délibéré. Une jointure partirait des adhésions et ferait disparaître
 * les comptes qui n'en ont aucune — précisément ceux qu'un
 * administrateur doit voir, puisqu'un compte créé mais jamais rattaché
 * à une organisation ne peut rien faire et n'apparaît nulle part
 * ailleurs dans le produit.
 *
 * Ce que la RLS laisse passer n'est pas décidé ici : un administrateur
 * Elite Experience lit tout, un responsable d'organisation lit les
 * siens, les autres ne lisent qu'eux-mêmes. Ce module se contente
 * d'assembler, de trier et de filtrer ce qui est arrivé.
 */

export interface ProfilBrut {
  id: string;
  full_name: string | null;
  email: string;
  status: string;
  created_at?: string | null;
}

export interface AdhesionBrute {
  user_id: string;
  organization_id: string;
  role: MemberRole;
  status: string;
}

export interface OrganisationBrute {
  id: string;
  name: string;
  type: OrgType;
}

export interface AdhesionAnnuaire {
  organisationId: string;
  organisation: string;
  type: OrgType | null;
  role: MemberRole;
  actif: boolean;
}

export interface LigneAnnuaire {
  id: string;
  nom: string;
  email: string;
  actif: boolean;
  creeLe: string | null;
  adhesions: AdhesionAnnuaire[];
  /** Rôles tenus au titre d'une adhésion ACTIVE, du plus fort au plus faible. */
  roles: MemberRole[];
  /** Aucun rattachement actif : le compte ne peut rien faire. */
  orphelin: boolean;
}

/** Ordre d'affichage des rôles : le plus engageant d'abord. */
const ORDRE_ROLES: MemberRole[] = [
  "admin",
  "designer",
  "trainer",
  "manager",
  "learner",
];

/**
 * Forme comparable d'un texte : sans accents, sans casse, sans espaces
 * superflus. Sans cette normalisation, chercher « Kone » ne trouverait
 * pas « Koné » — inacceptable pour un annuaire ivoirien.
 */
export function normaliser(texte: string): string {
  return texte
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

/** Assemble les trois lectures en lignes d'annuaire, triées par nom. */
export function construireAnnuaire(
  profils: ProfilBrut[],
  adhesions: AdhesionBrute[],
  organisations: OrganisationBrute[]
): LigneAnnuaire[] {
  const parOrganisation = new Map(organisations.map((o) => [o.id, o]));

  const parUtilisateur = new Map<string, AdhesionAnnuaire[]>();
  for (const a of adhesions) {
    const org = parOrganisation.get(a.organization_id);
    const liste = parUtilisateur.get(a.user_id) ?? [];
    liste.push({
      organisationId: a.organization_id,
      // Une organisation que la RLS n'a pas laissé lire reste nommée :
      // taire l'adhésion ferait croire à un compte non rattaché.
      organisation: org?.name ?? "Organisation non accessible",
      type: org?.type ?? null,
      role: a.role,
      actif: a.status === "active",
    });
    parUtilisateur.set(a.user_id, liste);
  }

  const lignes = profils.map((p): LigneAnnuaire => {
    const adhesionsUtilisateur = (parUtilisateur.get(p.id) ?? []).sort((x, y) =>
      x.organisation.localeCompare(y.organisation, "fr")
    );
    const actives = adhesionsUtilisateur.filter((a) => a.actif);
    const roles = ORDRE_ROLES.filter((r) => actives.some((a) => a.role === r));

    return {
      id: p.id,
      nom: (p.full_name ?? "").trim(),
      email: p.email,
      actif: p.status === "active",
      creeLe: p.created_at ?? null,
      adhesions: adhesionsUtilisateur,
      roles,
      orphelin: actives.length === 0,
    };
  });

  // Tri par nom, e-mail en repli : un compte sans nom renseigné reste
  // trouvable, et l'ordre ne dépend jamais de l'ordre d'arrivée.
  return lignes.sort((a, b) =>
    (a.nom || a.email).localeCompare(b.nom || b.email, "fr", {
      sensitivity: "base",
    })
  );
}

export interface FiltresAnnuaire {
  recherche?: string;
  role?: MemberRole | "";
  organisation?: string;
  statut?: "actif" | "suspendu" | "orphelin" | "";
}

/** Applique les filtres de l'écran. Un filtre vide ne filtre rien. */
export function filtrerAnnuaire(
  lignes: LigneAnnuaire[],
  filtres: FiltresAnnuaire
): LigneAnnuaire[] {
  const recherche = normaliser(filtres.recherche ?? "");

  return lignes.filter((l) => {
    if (recherche) {
      const cible = `${normaliser(l.nom)} ${normaliser(l.email)}`;
      if (!cible.includes(recherche)) return false;
    }

    // Le filtre par rôle ne considère que les adhésions actives : un rôle
    // détenu dans une adhésion suspendue n'est pas un rôle exercé.
    if (filtres.role && !l.roles.includes(filtres.role)) return false;

    if (
      filtres.organisation &&
      !l.adhesions.some((a) => a.organisationId === filtres.organisation)
    ) {
      return false;
    }

    if (filtres.statut === "actif" && !l.actif) return false;
    if (filtres.statut === "suspendu" && l.actif) return false;
    if (filtres.statut === "orphelin" && !l.orphelin) return false;

    return true;
  });
}

export interface SyntheseAnnuaire {
  comptes: number;
  actifs: number;
  orphelins: number;
  organisations: number;
}

/** Chiffres de tête, calculés sur l'annuaire complet (jamais sur le filtre). */
export function synthetiserAnnuaire(lignes: LigneAnnuaire[]): SyntheseAnnuaire {
  const organisations = new Set<string>();
  for (const l of lignes) {
    for (const a of l.adhesions) organisations.add(a.organisationId);
  }

  return {
    comptes: lignes.length,
    actifs: lignes.filter((l) => l.actif).length,
    orphelins: lignes.filter((l) => l.orphelin).length,
    organisations: organisations.size,
  };
}

/**
 * Niveaux de partage – logique pure, testable.
 *
 * Quatre périmètres, du plus fermé au plus ouvert : groupe (la
 * formation), entreprise (l'organisation), secteur, public. Ils sont
 * appliqués en base par la fonction `can_see_scope` (migration 0012) ;
 * ce module ne porte que le vocabulaire et les règles d'interface.
 */

export const PORTEES = ["group", "organization", "sector", "public"] as const;
export type Portee = (typeof PORTEES)[number];

export const PORTEE_PAR_DEFAUT: Portee = "organization";

export const PORTEE_LABELS: Record<Portee, string> = {
  group: "Groupe",
  organization: "Entreprise",
  sector: "Secteur",
  public: "Public",
};

export const PORTEE_DESCRIPTIONS: Record<Portee, string> = {
  group: "Visible uniquement par les apprenants inscrits à la même formation.",
  organization: "Visible par tous les membres de votre organisation.",
  sector:
    "Visible par les membres de toutes les organisations de votre secteur.",
  public: "Visible par toute personne connectée à Elite Academy.",
};

export function porteeValide(valeur: unknown): valeur is Portee {
  return typeof valeur === "string" && (PORTEES as readonly string[]).includes(valeur);
}

/** Lit une portée depuis un formulaire ou une URL, avec repli. */
export function lirePortee(valeur: unknown, defaut: Portee = PORTEE_PAR_DEFAUT): Portee {
  return porteeValide(valeur) ? valeur : defaut;
}

/**
 * Le niveau « groupe » n'a de sens que rattaché à une formation :
 * sans elle, le groupe n'existe pas.
 */
export function porteeExigeFormation(portee: Portee): boolean {
  return portee === "group";
}

/** Phrase d'aide affichée sous le sélecteur (addenda, « Sélecteur de visibilité »). */
export function recommandationPortee(portee: Portee): string {
  switch (portee) {
    case "group":
      return "Pour un contenu très spécifique à une formation, le groupe suffit.";
    case "organization":
      return "Pour un contenu interne, Entreprise est le choix le plus sûr.";
    case "sector":
      return "Pour inspirer d'autres organisations du même métier, sans exposer l'entreprise.";
    case "public":
      return "Pour un contenu de portfolio ou de ressource ouverte : vérifiez qu'il ne contient rien de confidentiel.";
  }
}

/** Ton de la pastille : plus la portée est large, plus la pastille se remarque. */
export function etiquettePortee(portee: Portee): {
  libelle: string;
  ton: "neutre" | "or" | "succes" | "alerte";
} {
  const ton = { group: "neutre", organization: "succes", sector: "or", public: "or" } as const;
  return { libelle: PORTEE_LABELS[portee], ton: ton[portee] };
}

import { STATUTS_AVEC_ACCES } from "@/lib/courses/inscriptions";

/**
 * Activité d'encadrement d'une personne — logique pure, testable.
 *
 * Sert le profil d'un formateur, d'un concepteur, d'un responsable ou
 * d'un administrateur. Dans ce produit, ces rôles ne s'inscrivent
 * jamais à une formation : ils la créent, l'animent, la pilotent. Leur
 * profil ne doit donc pas compter des inscriptions, des leçons
 * terminées ou des certificats détenus — ces compteurs resteraient à
 * zéro à vie et laisseraient croire à un compte inactif.
 *
 * Deux pièges, d'où ce module plutôt qu'un calcul dans la page :
 *
 * 1. Une même formation peut être rattachée par plusieurs faits à la
 *    fois — conçue ET animée en session, par exemple. Elle ne compte
 *    qu'une fois.
 * 2. Un apprenant inscrit à deux formations de la même personne est
 *    UNE personne encadrée, pas deux. Compter les inscriptions au lieu
 *    des inscrits gonflerait le chiffre sans prévenir.
 *
 * Le rattachement est ici personnel, et seulement personnel : ce que
 * VOUS encadrez. L'écran « Mes formations » retient une définition
 * plus large pour un responsable (toute formation de son organisation
 * ayant tourné), parce qu'il y pilote une organisation ; un profil,
 * lui, parle d'une personne.
 */

export interface InscriptionEncadree {
  course_id: string;
  user_id: string;
  status: string;
}

export interface SyntheseEncadrement {
  /** Formations conçues, affectées ou animées — sans doublon. */
  formations: number;
  /** Sessions présentielles animées par la personne. */
  sessions: number;
  /** Personnes distinctes inscrites à ces formations. */
  apprenants: number;
  /** Certificats valides délivrés par la personne. */
  certificats: number;
}

/** Identifiants des formations rattachées à la personne, sans doublon. */
export function formationsEncadrees({
  conception = [],
  affectation = [],
  session = [],
}: {
  conception?: string[];
  affectation?: string[];
  session?: string[];
}): string[] {
  const ids = new Set<string>();
  for (const liste of [conception, affectation, session]) {
    for (const id of liste) {
      if (id) ids.add(id);
    }
  }
  return [...ids];
}

export function synthetiserEncadrement({
  formations,
  sessions,
  inscriptions,
  certificatsDelivres,
}: {
  formations: string[];
  sessions: number;
  inscriptions: InscriptionEncadree[];
  certificatsDelivres: number;
}): SyntheseEncadrement {
  const perimetre = new Set(formations);

  /* Une inscription abandonnée ou suspendue ne donne plus accès à la
     formation : la personne n'est plus encadrée, et la compter
     laisserait croire à un effectif qu'on ne suit plus. Même règle
     que partout ailleurs dans le produit. */
  const apprenants = new Set(
    inscriptions
      .filter(
        (i) =>
          perimetre.has(i.course_id) &&
          STATUTS_AVEC_ACCES.includes(i.status as "active" | "completed")
      )
      .map((i) => i.user_id)
  );

  return {
    formations: perimetre.size,
    sessions,
    apprenants: apprenants.size,
    certificats: certificatsDelivres,
  };
}

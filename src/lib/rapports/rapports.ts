/**
 * Rapports d'organisation — logique pure, testable unitairement.
 *
 * Deux partis pris, qui changent les chiffres affichés :
 *
 * 1. Les désinscriptions sortent du dénominateur du taux d'achèvement.
 *    Quelqu'un qui se retire n'est pas un échec de la formation, et le
 *    compter comme tel ferait baisser le taux d'une formation sans que
 *    personne n'y ait échoué. Elles sont comptées à part, car un nombre
 *    élevé reste un signal — mais un signal différent.
 *
 * 2. Les listes sont classées du taux le plus faible au plus fort. Un
 *    responsable ouvre cet écran pour savoir où intervenir ; un tri
 *    alphabétique l'obligerait à lire toute la liste pour le découvrir.
 *    C'est le même principe que l'écran Résultats du formateur.
 */

export interface InscriptionBrute {
  user_id: string;
  course_id: string;
  status: string;
}

export interface CertificatBrut {
  user_id: string;
  course_id: string;
  status: string;
}

export interface SyntheseOrganisation {
  apprenants: number;
  inscriptions: number;
  achevees: number;
  desinscriptions: number;
  certificats: number;
  /** Achèvements rapportés aux inscriptions retenues, en pourcentage entier. */
  tauxAchevement: number | null;
}

/** Inscriptions retenues dans le calcul du taux (tout sauf désinscription). */
function retenues(inscriptions: InscriptionBrute[]): InscriptionBrute[] {
  return inscriptions.filter((i) => i.status !== "withdrawn");
}

function taux(achevees: number, total: number): number | null {
  if (total === 0) return null;
  return Math.round((achevees / total) * 100);
}

export function synthetiserOrganisation(
  inscriptions: InscriptionBrute[],
  certificats: CertificatBrut[]
): SyntheseOrganisation {
  const compte = retenues(inscriptions);
  const achevees = compte.filter((i) => i.status === "completed").length;

  return {
    apprenants: new Set(inscriptions.map((i) => i.user_id)).size,
    inscriptions: compte.length,
    achevees,
    desinscriptions: inscriptions.length - compte.length,
    // Un certificat révoqué ne compte pas : il ne vaut plus rien.
    certificats: certificats.filter((c) => c.status === "valid").length,
    tauxAchevement: taux(achevees, compte.length),
  };
}

export interface LigneFormation {
  courseId: string;
  titre: string;
  inscrits: number;
  enCours: number;
  achevees: number;
  desinscriptions: number;
  certificats: number;
  tauxAchevement: number | null;
}

export function parFormation(
  inscriptions: InscriptionBrute[],
  certificats: CertificatBrut[],
  titres: Map<string, string>
): LigneFormation[] {
  const ids = new Set(inscriptions.map((i) => i.course_id));

  const lignes = [...ids].map((courseId): LigneFormation => {
    const toutes = inscriptions.filter((i) => i.course_id === courseId);
    const compte = retenues(toutes);
    const achevees = compte.filter((i) => i.status === "completed").length;

    return {
      courseId,
      titre: titres.get(courseId) ?? "Formation retirée du catalogue",
      inscrits: compte.length,
      enCours: compte.filter((i) => i.status === "active").length,
      achevees,
      desinscriptions: toutes.length - compte.length,
      certificats: certificats.filter(
        (c) => c.course_id === courseId && c.status === "valid"
      ).length,
      tauxAchevement: taux(achevees, compte.length),
    };
  });

  return trierParTaux(lignes, (l) => l.titre);
}

export interface LigneApprenant {
  userId: string;
  nom: string;
  inscriptions: number;
  enCours: number;
  achevees: number;
  certificats: number;
  tauxAchevement: number | null;
}

export function parApprenant(
  inscriptions: InscriptionBrute[],
  certificats: CertificatBrut[],
  noms: Map<string, string>
): LigneApprenant[] {
  const ids = new Set(inscriptions.map((i) => i.user_id));

  const lignes = [...ids].map((userId): LigneApprenant => {
    const compte = retenues(inscriptions.filter((i) => i.user_id === userId));
    const achevees = compte.filter((i) => i.status === "completed").length;

    return {
      userId,
      nom: noms.get(userId) ?? "Compte inconnu",
      inscriptions: compte.length,
      enCours: compte.filter((i) => i.status === "active").length,
      achevees,
      certificats: certificats.filter(
        (c) => c.user_id === userId && c.status === "valid"
      ).length,
      tauxAchevement: taux(achevees, compte.length),
    };
  });

  return trierParTaux(lignes, (l) => l.nom);
}

/**
 * Tri commun : taux le plus faible d'abord, puis par libellé.
 *
 * Une ligne sans taux (aucune inscription retenue) passe en dernier :
 * elle n'a rien à dire, et la placer en tête reviendrait à la traiter
 * comme le pire cas alors qu'elle n'est simplement pas mesurable.
 */
function trierParTaux<T extends { tauxAchevement: number | null }>(
  lignes: T[],
  libelle: (l: T) => string
): T[] {
  return lignes.sort((a, b) => {
    if (a.tauxAchevement === null && b.tauxAchevement === null) {
      return libelle(a).localeCompare(libelle(b), "fr");
    }
    if (a.tauxAchevement === null) return 1;
    if (b.tauxAchevement === null) return -1;
    if (a.tauxAchevement !== b.tauxAchevement) {
      return a.tauxAchevement - b.tauxAchevement;
    }
    return libelle(a).localeCompare(libelle(b), "fr");
  });
}

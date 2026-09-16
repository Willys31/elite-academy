/**
 * Classements – logique pure, testable.
 *
 * Addendum Gamification §7 : périmètre = une formation, jamais toute la
 * plateforme ; fenêtre hebdomadaire ou mensuelle ; Top 10, position
 * personnelle et « les 5 autour de toi ». Égalités : badges de la
 * fenêtre, puis score moyen, puis ancienneté d'inscription.
 *
 * Les agrégats viennent de la fonction SQL `classement_formation`
 * (migration 0013), qui exclut les apprenants ayant désactivé leur
 * affichage. Le tri se fait ici, où il est testable.
 *
 * Les fenêtres sont calculées en UTC (approximation assumée en v1).
 */

export type Fenetre = "semaine" | "mois";

export const FENETRE_LABELS: Record<Fenetre, string> = {
  semaine: "Cette semaine",
  mois: "Ce mois",
};

export function fenetreValide(v: unknown): v is Fenetre {
  return v === "semaine" || v === "mois";
}

export interface BornesFenetre {
  fenetre: Fenetre;
  /** ISO, inclus. */
  debut: string;
  /** ISO, exclu. */
  fin: string;
  libelle: string;
}

const MOIS = [
  "janvier", "février", "mars", "avril", "mai", "juin",
  "juillet", "août", "septembre", "octobre", "novembre", "décembre",
];

export function fenetreClassement(fenetre: Fenetre, maintenant: Date = new Date()): BornesFenetre {
  const y = maintenant.getUTCFullYear();
  const m = maintenant.getUTCMonth();
  const d = maintenant.getUTCDate();

  if (fenetre === "mois") {
    const debut = new Date(Date.UTC(y, m, 1));
    const fin = new Date(Date.UTC(y, m + 1, 1));
    return {
      fenetre,
      debut: debut.toISOString(),
      fin: fin.toISOString(),
      libelle: `${MOIS[m][0].toUpperCase()}${MOIS[m].slice(1)} ${y}`,
    };
  }

  // Semaine du lundi au dimanche.
  const jourSemaine = (maintenant.getUTCDay() + 6) % 7; // lundi = 0
  const debut = new Date(Date.UTC(y, m, d - jourSemaine));
  const fin = new Date(Date.UTC(y, m, d - jourSemaine + 7));
  const dernier = new Date(fin.getTime() - 86_400_000);
  const memeMois = debut.getUTCMonth() === dernier.getUTCMonth();
  const libelle = memeMois
    ? `Semaine du ${debut.getUTCDate()} au ${dernier.getUTCDate()} ${MOIS[debut.getUTCMonth()]}`
    : `Semaine du ${debut.getUTCDate()} ${MOIS[debut.getUTCMonth()]} au ${dernier.getUTCDate()} ${MOIS[dernier.getUTCMonth()]}`;
  return { fenetre, debut: debut.toISOString(), fin: fin.toISOString(), libelle };
}

export interface LigneClassement {
  user_id: string;
  nom_affiche: string;
  xp_total: number;
  nb_badges: number;
  score_moyen: number | null;
  inscrit_le: string | null;
}

export interface LigneClassee extends LigneClassement {
  rang: number;
  moi: boolean;
}

export interface Classement {
  classes: LigneClassee[];
  top: LigneClassee[];
  maPosition: LigneClassee | null;
  autourDeMoi: LigneClassee[];
  nbParticipants: number;
}

function comparer(a: LigneClassement, b: LigneClassement): number {
  if (b.xp_total !== a.xp_total) return b.xp_total - a.xp_total;
  if (b.nb_badges !== a.nb_badges) return b.nb_badges - a.nb_badges;
  const sa = a.score_moyen ?? -1;
  const sb = b.score_moyen ?? -1;
  if (sb !== sa) return sb - sa;
  const ia = a.inscrit_le ?? "9999";
  const ib = b.inscrit_le ?? "9999";
  return ia < ib ? -1 : ia > ib ? 1 : a.user_id.localeCompare(b.user_id);
}

function exAequo(a: LigneClassement, b: LigneClassement): boolean {
  return (
    a.xp_total === b.xp_total &&
    a.nb_badges === b.nb_badges &&
    (a.score_moyen ?? -1) === (b.score_moyen ?? -1)
  );
}

export const TAILLE_TOP = 10;

export function classerParticipants(lignes: LigneClassement[], moi: string): Classement {
  const triees = [...lignes].sort(comparer);
  const classes: LigneClassee[] = [];
  triees.forEach((l, i) => {
    const precedente = classes[i - 1];
    const rang = precedente && exAequo(precedente, l) ? precedente.rang : i + 1;
    classes.push({ ...l, rang, moi: l.user_id === moi });
  });

  const index = classes.findIndex((l) => l.moi);
  const maPosition = index >= 0 ? classes[index] : null;
  const autourDeMoi =
    index >= 0 ? classes.slice(Math.max(0, index - 2), Math.min(classes.length, index + 3)) : [];

  return {
    classes,
    top: classes.slice(0, TAILLE_TOP),
    maPosition,
    autourDeMoi,
    nbParticipants: classes.length,
  };
}

export type Medaille = "or" | "argent" | "bronze" | null;

export function medaille(rang: number): Medaille {
  if (rang === 1) return "or";
  if (rang === 2) return "argent";
  if (rang === 3) return "bronze";
  return null;
}

/**
 * Niveau global (1 → 50) – logique pure, testable.
 *
 * Addendum Gamification §6 : six paliers avec un titre, découpés en
 * niveaux. Ce niveau synthétise l'activité sur la plateforme ; il est
 * distinct des niveaux officiels par compétence (Fondamentaux → Elite)
 * et ne donne jamais d'avantage pédagogique.
 */

export interface Palier {
  titre: string;
  xpMin: number;
  /** null pour le dernier palier (ouvert). */
  xpMax: number | null;
  niveauMin: number;
  niveauMax: number;
}

export const PALIERS: readonly Palier[] = [
  { titre: "Débutant", xpMin: 0, xpMax: 500, niveauMin: 1, niveauMax: 5 },
  { titre: "Actif", xpMin: 501, xpMax: 1500, niveauMin: 6, niveauMax: 10 },
  { titre: "Confirmé", xpMin: 1501, xpMax: 5000, niveauMin: 11, niveauMax: 20 },
  { titre: "Expérimenté", xpMin: 5001, xpMax: 10000, niveauMin: 21, niveauMax: 30 },
  { titre: "Expert", xpMin: 10001, xpMax: 20000, niveauMin: 31, niveauMax: 40 },
  { titre: "Légende", xpMin: 20001, xpMax: null, niveauMin: 41, niveauMax: 50 },
];

/** Dans le palier ouvert, chaque niveau vaut 2 000 XP. */
export const XP_PAR_NIVEAU_LEGENDE = 2000;
export const NIVEAU_MAX = 50;

export interface NiveauGlobal {
  niveau: number;
  titre: string;
  xpTotal: number;
  /** XP au début du niveau courant. */
  xpNiveauDebut: number;
  /** XP à atteindre pour le niveau suivant ; null au niveau 50. */
  xpNiveauSuivant: number | null;
  xpDansNiveau: number;
  progressionPourcent: number;
}

export function palierPourXp(xp: number): Palier {
  const x = Math.max(0, xp);
  return PALIERS.find((p) => p.xpMax === null || x <= p.xpMax) ?? PALIERS[PALIERS.length - 1];
}

/** Largeur en XP d'un niveau du palier (uniforme dans le palier). */
function largeurNiveau(palier: Palier): number {
  if (palier.xpMax === null) return XP_PAR_NIVEAU_LEGENDE;
  const nb = palier.niveauMax - palier.niveauMin + 1;
  return (palier.xpMax - palier.xpMin + 1) / nb;
}

export function niveauDepuisXp(xpTotal: number): NiveauGlobal {
  const xp = Math.max(0, Math.floor(xpTotal));
  const palier = palierPourXp(xp);
  const largeur = largeurNiveau(palier);
  const rang = Math.floor((xp - palier.xpMin) / largeur);
  const niveau = Math.min(NIVEAU_MAX, palier.niveauMin + rang);

  const xpNiveauDebut = Math.round(palier.xpMin + (niveau - palier.niveauMin) * largeur);
  const xpNiveauSuivant =
    niveau >= NIVEAU_MAX ? null : Math.round(palier.xpMin + (niveau - palier.niveauMin + 1) * largeur);
  const xpDansNiveau = xp - xpNiveauDebut;
  const progressionPourcent =
    xpNiveauSuivant === null
      ? 100
      : Math.min(100, Math.round((xpDansNiveau / (xpNiveauSuivant - xpNiveauDebut)) * 100));

  return {
    niveau,
    titre: palier.titre,
    xpTotal: xp,
    xpNiveauDebut,
    xpNiveauSuivant,
    xpDansNiveau,
    progressionPourcent,
  };
}

/** Le gain fait-il changer de niveau ? Renvoie le nouveau niveau, sinon null. */
export function aChangeDeNiveau(xpAvant: number, xpApres: number): NiveauGlobal | null {
  const avant = niveauDepuisXp(xpAvant);
  const apres = niveauDepuisXp(xpApres);
  return apres.niveau > avant.niveau ? apres : null;
}

/** « Niveau 12 · Confirmé · 340/600 XP » */
export function libelleNiveau(n: NiveauGlobal): string {
  const progression =
    n.xpNiveauSuivant === null
      ? `${n.xpTotal} XP`
      : `${n.xpDansNiveau}/${n.xpNiveauSuivant - n.xpNiveauDebut} XP`;
  return `Niveau ${n.niveau} · ${n.titre} · ${progression}`;
}

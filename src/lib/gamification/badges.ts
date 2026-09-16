/**
 * Catalogue et déblocage des badges – logique pure, testable.
 *
 * Addendum Gamification §4 (badges classiques) et §5 (distinctions).
 *
 * Deux mécanismes de déblocage :
 * - **badges à compteur** (`compteur` renseigné) : un compteur brut
 *   tenu par le moteur (`badge_progress`) franchit une cible
 *   (`evaluerBadges`) ;
 * - **badges événementiels** (`compteur` null, `contexte` renseigné) :
 *   décernés directement par le moteur quand un événement précis
 *   survient (une compétence qui monte de niveau, un top 1 de session),
 *   avec un `context_key` qui autorise la répétition.
 *
 * Les distinctions (`special`) ne se débloquent jamais seules : elles
 * sont proposées puis validées par un formateur (`special_mentions`).
 *
 * Ce catalogue est la source de vérité ; la migration 0013 en contient
 * une copie de départ, et le moteur réinsère toute clé manquante.
 *
 * Volontairement absents (non mesurables sans télémétrie de connexion
 * ou de session continue) : « Rituel » et « Marathon ».
 */

export const FAMILLES = [
  "performance",
  "regularite",
  "maitrise",
  "progression",
  "session",
  "communaute",
  "distinction",
] as const;
export type Famille = (typeof FAMILLES)[number];

export const FAMILLE_LABELS: Record<Famille, string> = {
  performance: "Performance",
  regularite: "Régularité",
  maitrise: "Maîtrise",
  progression: "Progression",
  session: "Session",
  communaute: "Communauté",
  distinction: "Distinctions",
};

export const PALIERS_BADGE = ["bronze", "argent", "or", "platine"] as const;
export type PalierBadge = (typeof PALIERS_BADGE)[number];

export const PALIER_LABELS: Record<PalierBadge, string> = {
  bronze: "Bronze",
  argent: "Argent",
  or: "Or",
  platine: "Platine",
};

export type ContexteBadge = "formation" | "competence" | "session" | "secteur" | "activite";

export interface BadgeDefinition {
  key: string;
  famille: Famille;
  nom: string;
  description: string;
  /** Clé du compteur dans `badge_progress` ; null = événementiel. */
  compteur: string | null;
  cible: number | null;
  palier: PalierBadge | null;
  special: boolean;
  /** Décernable plusieurs fois, une par valeur de contexte. */
  contexte: ContexteBadge | null;
  ordre: number;
}

function serie(
  base: string,
  famille: Famille,
  nom: string,
  compteur: string,
  unite: string,
  paliers: Array<[PalierBadge, number]>,
  ordre: number
): BadgeDefinition[] {
  return paliers.map(([palier, cible], i) => ({
    key: `${base}_${palier}`,
    famille,
    nom: `${nom} ${PALIER_LABELS[palier]}`,
    description: `${cible} ${unite}`,
    compteur,
    cible,
    palier,
    special: false,
    contexte: null,
    ordre: ordre + i,
  }));
}

export const CATALOGUE_BADGES: readonly BadgeDefinition[] = [
  // ----- Performance -----
  ...serie("reflexe", "performance", "Réflexe", "reflexe", "QCM avec bonus de rapidité", [
    ["bronze", 1], ["argent", 5], ["or", 20], ["platine", 50],
  ], 10),
  ...serie("sans_faute", "performance", "Sans faute", "sans_faute", "activités réussies à 100 %", [
    ["bronze", 1], ["argent", 5], ["or", 15],
  ], 20),
  ...serie("expert", "performance", "Expert", "expert_competences", "compétences avec un score moyen ≥ 90 %", [
    ["bronze", 1], ["argent", 3],
  ], 30),
  {
    key: "expert_or", famille: "performance", nom: "Expert Or",
    description: "Score moyen ≥ 90 % sur toutes les compétences d'une formation",
    compteur: null, cible: null, palier: "or", special: false, contexte: "formation", ordre: 32,
  },
  // ----- Régularité -----
  { key: "serie_7", famille: "regularite", nom: "Série 7 jours", description: "7 jours consécutifs d'activité", compteur: "serie_jours", cible: 7, palier: "bronze", special: false, contexte: null, ordre: 40 },
  { key: "serie_30", famille: "regularite", nom: "Série 30 jours", description: "30 jours consécutifs d'activité", compteur: "serie_jours", cible: 30, palier: "argent", special: false, contexte: null, ordre: 41 },
  { key: "serie_100", famille: "regularite", nom: "Série 100 jours", description: "100 jours consécutifs d'activité", compteur: "serie_jours", cible: 100, palier: "or", special: false, contexte: null, ordre: 42 },
  { key: "serie_365", famille: "regularite", nom: "Série 365 jours", description: "Une année entière d'activité quotidienne", compteur: "serie_jours", cible: 365, palier: "platine", special: false, contexte: null, ordre: 43 },
  // ----- Maîtrise -----
  ...serie("operationnel", "maitrise", "Opérationnel", "operationnel_competences", "compétences au niveau Opérationnel ou plus", [
    ["bronze", 1], ["argent", 3], ["or", 5],
  ], 50),
  ...serie("avance", "maitrise", "Avancé", "avance_competences", "compétences au niveau Avancé ou plus", [
    ["bronze", 1], ["argent", 3],
  ], 55),
  { key: "elite", famille: "maitrise", nom: "Elite", description: "Niveau Elite validé sur une compétence", compteur: "elite_competences", cible: 1, palier: null, special: false, contexte: null, ordre: 58 },
  { key: "polyvalent", famille: "maitrise", nom: "Polyvalent", description: "Niveau Opérationnel ou plus dans 3 domaines de compétence différents", compteur: "domaines_operationnels", cible: 3, palier: null, special: false, contexte: null, ordre: 59 },
  // ----- Progression -----
  { key: "progression", famille: "progression", nom: "Progression", description: "Un niveau gagné sur une compétence", compteur: null, cible: null, palier: null, special: false, contexte: "competence", ordre: 60 },
  { key: "comeback", famille: "progression", nom: "Comeback", description: "Remontée de moins de 50 % à plus de 80 % sur une activité", compteur: null, cible: null, palier: null, special: false, contexte: "activite", ordre: 61 },
  { key: "eclaire", famille: "progression", nom: "Éclairé", description: "10 blocages identifiés puis surmontés grâce aux exercices personnalisés", compteur: "eclaire", cible: 10, palier: null, special: false, contexte: null, ordre: 62 },
  { key: "problem_solver", famille: "progression", nom: "Problem Solver", description: "5 situations de travail à résolution complexe validées", compteur: "problem_solver", cible: 5, palier: null, special: false, contexte: null, ordre: 63 },
  // ----- Session -----
  ...serie("present", "session", "Présent", "sessions_presentes", "sessions présentielles suivies", [
    ["bronze", 1], ["argent", 5], ["or", 20],
  ], 70),
  { key: "actif_session", famille: "session", nom: "Actif en session", description: "A répondu à toutes les activités d'une session", compteur: null, cible: null, palier: null, special: false, contexte: "session", ordre: 73 },
  { key: "roi_du_direct", famille: "session", nom: "Roi du direct", description: "Premier du classement d'une session", compteur: null, cible: null, palier: null, special: false, contexte: "session", ordre: 74 },
  // ----- Communauté -----
  { key: "expert_contributor", famille: "communaute", nom: "Expert Contributor", description: "20 aides votées « Utile » par au moins 2 pairs chacune", compteur: "contributions_utiles", cible: 20, palier: null, special: false, contexte: null, ordre: 80 },
  { key: "top_contributor", famille: "communaute", nom: "Top Contributor", description: "500 votes « Utile » reçus sur vos aides et situations", compteur: "votes_recus", cible: 500, palier: null, special: false, contexte: null, ordre: 81 },
  { key: "storyteller", famille: "communaute", nom: "Storyteller", description: "10 situations de travail validées, avec au moins 5 votes « Utile » en moyenne", compteur: "situations_storyteller", cible: 10, palier: null, special: false, contexte: null, ordre: 82 },
  { key: "expert_secteur", famille: "communaute", nom: "Expert de secteur", description: "5 situations de travail validées dans un même secteur", compteur: null, cible: null, palier: null, special: false, contexte: "secteur", ordre: 83 },
  // ----- Distinctions (validation formateur obligatoire) -----
  { key: "elite_performer", famille: "distinction", nom: "Elite Performer", description: "Top 1 du classement quatre semaines de suite, badge Expert Or et 100 % à toutes les activités", compteur: null, cible: null, palier: null, special: true, contexte: null, ordre: 90 },
  { key: "rising_star", famille: "distinction", nom: "Rising Star", description: "Remontée spectaculaire : de moins de 30 % à plus de 90 % sur une formation complète", compteur: null, cible: null, palier: null, special: true, contexte: "formation", ordre: 91 },
  { key: "excellence_award", famille: "distinction", nom: "Excellence Award", description: "Toutes les compétences d'une formation au niveau Opérationnel ou plus, 100 % de réussite", compteur: null, cible: null, palier: null, special: true, contexte: "formation", ordre: 92 },
  { key: "commitment_award", famille: "distinction", nom: "Commitment Award", description: "365 jours consécutifs d'activité et aucune absence aux sessions obligatoires", compteur: null, cible: null, palier: null, special: true, contexte: null, ordre: 93 },
  { key: "mentor", famille: "distinction", nom: "Mentor", description: "Expert Contributor, 20 aides validées et 5 situations de travail partagées", compteur: null, cible: null, palier: null, special: true, contexte: null, ordre: 94 },
];

const PAR_CLE = new Map(CATALOGUE_BADGES.map((b) => [b.key, b]));

export function badgeParCle(key: string): BadgeDefinition | undefined {
  return PAR_CLE.get(key);
}

/** Clé d'obtention : `key` seule, ou `key|contexte` pour un badge répétable. */
export function cleObtention(key: string, contextKey = ""): string {
  return contextKey ? `${key}|${contextKey}` : key;
}

export interface BadgeDebloque {
  key: string;
  contextKey: string;
}

/**
 * Badges à compteur nouvellement atteints. `dejaObtenus` contient les
 * clés d'obtention (`cleObtention`) déjà en base.
 */
export function evaluerBadges(
  compteurs: Record<string, number>,
  dejaObtenus: Set<string>
): BadgeDebloque[] {
  const nouveaux: BadgeDebloque[] = [];
  for (const b of CATALOGUE_BADGES) {
    if (b.special || b.compteur === null || b.cible === null) continue;
    if (dejaObtenus.has(cleObtention(b.key))) continue;
    if ((compteurs[b.compteur] ?? 0) >= b.cible) {
      nouveaux.push({ key: b.key, contextKey: "" });
    }
  }
  return nouveaux;
}

export interface ProchainBadge {
  badge: BadgeDefinition;
  actuel: number;
  cible: number;
}

/**
 * Le badge à compteur le plus proche d'être atteint (meilleur ratio),
 * en ne proposant que le premier palier manquant de chaque compteur.
 */
export function prochainBadge(
  compteurs: Record<string, number>,
  dejaObtenus: Set<string>
): ProchainBadge | null {
  let meilleur: ProchainBadge | null = null;
  const compteursVus = new Set<string>();
  for (const b of [...CATALOGUE_BADGES].sort((a, c) => a.ordre - c.ordre)) {
    if (b.special || b.compteur === null || b.cible === null) continue;
    if (dejaObtenus.has(cleObtention(b.key))) continue;
    if (compteursVus.has(b.compteur)) continue;
    compteursVus.add(b.compteur);
    const actuel = compteurs[b.compteur] ?? 0;
    const candidat = { badge: b, actuel, cible: b.cible };
    if (!meilleur || actuel / b.cible > meilleur.actuel / meilleur.cible) {
      meilleur = candidat;
    }
  }
  return meilleur;
}

/** Badges classiques (non spéciaux), triés pour l'affichage. */
export function badgesClassiques(): BadgeDefinition[] {
  return CATALOGUE_BADGES.filter((b) => !b.special).sort((a, b) => a.ordre - b.ordre);
}

export function distinctions(): BadgeDefinition[] {
  return CATALOGUE_BADGES.filter((b) => b.special).sort((a, b) => a.ordre - b.ordre);
}

/**
 * Badges classiques dont l'obtention propose automatiquement une
 * distinction à valider par un formateur (addendum Entraide §5.3,
 * Gamification §5.2).
 */
export const DISTINCTION_DECLENCHEE_PAR: Record<string, string> = {
  serie_365: "commitment_award",
};

/** Compteurs de maîtrise, dérivés de `progress_records`. */
export function compteursMaitrise(
  competences: Array<{ mastery_level: string | null; domain: string | null }>
): Record<string, number> {
  const rang: Record<string, number> = { fundamentals: 1, operational: 2, advanced: 3, elite: 4 };
  const domaines = new Set<string>();
  let operationnel = 0;
  let avance = 0;
  let elite = 0;
  for (const c of competences) {
    const r = c.mastery_level ? (rang[c.mastery_level] ?? 0) : 0;
    if (r >= 2) {
      operationnel++;
      domaines.add((c.domain ?? "général").trim().toLowerCase());
    }
    if (r >= 3) avance++;
    if (r >= 4) elite++;
  }
  return {
    operationnel_competences: operationnel,
    avance_competences: avance,
    elite_competences: elite,
    domaines_operationnels: domaines.size,
  };
}

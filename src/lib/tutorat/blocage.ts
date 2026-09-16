/**
 * Score de blocage et adaptation – logique pure, testable.
 *
 * Addendum Tutorat IA §4 :
 *   score = (aides + reformulations + tentatives échouées) / tentatives
 * borné à 1, cinq bandes (aucun, léger, modéré, important, critique),
 * alerte formateur à partir de 0,6 ; types de blocage (conceptuel,
 * méthodologique, calcul, contexte, attention) déduits des boutons
 * utilisés et des tentatives ; §7 barème XP des exercices.
 */

export const TYPES_AIDE = ["reformulate", "dont_understand", "hint", "example", "detailed_explanation"] as const;
export type TypeAide = (typeof TYPES_AIDE)[number];

export const TYPE_AIDE_LABELS: Record<TypeAide, string> = {
  reformulate: "Reformuler",
  dont_understand: "Je ne comprends pas",
  hint: "Voir un indice",
  example: "Voir un exemple",
  detailed_explanation: "Explication détaillée",
};

export function typeAideValide(v: unknown): v is TypeAide {
  return typeof v === "string" && (TYPES_AIDE as readonly string[]).includes(v);
}

/** Une explication détaillée révèle la correction : elle exige une tentative. */
export function aideAutorisee(type: TypeAide, aUneTentative: boolean): boolean {
  return type !== "detailed_explanation" || aUneTentative;
}

export const SCORE_ECHEC = 60;

export interface EntreeBlocage {
  /** Aides hors reformulation. */
  nbAides: number;
  nbReformulations: number;
  /** Tentatives avec score < 60 %. */
  nbEchecs: number;
  nbTentatives: number;
}

/** null tant qu'aucune tentative : rien à mesurer. */
export function scoreDeBlocage(e: EntreeBlocage): number | null {
  if (e.nbTentatives <= 0) return null;
  const brut = (e.nbAides + e.nbReformulations + e.nbEchecs) / e.nbTentatives;
  return Math.round(Math.min(1, Math.max(0, brut)) * 100) / 100;
}

export type Bande = "aucun" | "leger" | "modere" | "important" | "critique";

export const BANDES: Array<{ max: number; bande: Bande; libelle: string; action: string }> = [
  { max: 0.2, bande: "aucun", libelle: "Aucun blocage significatif", action: "Exercices standards, progression normale." },
  { max: 0.4, bande: "leger", libelle: "Blocages légers", action: "Exercices de consolidation, indices fréquents." },
  { max: 0.6, bande: "modere", libelle: "Blocages modérés", action: "Exercices de remédiation, explications détaillées." },
  { max: 0.8, bande: "important", libelle: "Blocages importants", action: "Exercices de base, reformulations systématiques ; le formateur est alerté." },
  { max: 1, bande: "critique", libelle: "Blocages critiques", action: "Pause recommandée ; un entretien avec le formateur est conseillé." },
];

export function bandeDeBlocage(score: number | null): (typeof BANDES)[number] {
  if (score === null) return BANDES[0];
  return BANDES.find((b) => score <= b.max) ?? BANDES[BANDES.length - 1];
}

export const TON_BANDE: Record<Bande, "neutre" | "or" | "succes" | "alerte"> = {
  aucun: "succes",
  leger: "neutre",
  modere: "or",
  important: "alerte",
  critique: "alerte",
};

export const SEUIL_ALERTE = 0.6;
export const SEUIL_FIN_ALERTE = 0.4;

/** Alerter quand on franchit 0,6 ; réarmer une fois repassé sous 0,4. */
export function doitAlerter(scoreAvant: number | null, scoreApres: number | null, dejaAlerte: boolean): boolean {
  if (scoreApres === null || scoreApres < SEUIL_ALERTE) return false;
  if (!dejaAlerte) return true;
  // Déjà alerté : ne réalerter que si le score était redescendu sous 0,4.
  return scoreAvant !== null && scoreAvant < SEUIL_FIN_ALERTE;
}

export const TYPES_BLOCAGE = ["conceptuel", "methodologique", "calcul", "contexte", "attention"] as const;
export type TypeBlocage = (typeof TYPES_BLOCAGE)[number];

export const TYPE_BLOCAGE_LABELS: Record<TypeBlocage, string> = {
  conceptuel: "Conceptuel",
  methodologique: "Méthodologique",
  calcul: "Calcul",
  contexte: "Contexte professionnel",
  attention: "Attention",
};

export interface EntreeTypesBlocage {
  aides: Array<{ help_type: string }>;
  /** Tentatives : score et durée moyenne par question (secondes), si connue. */
  tentatives: Array<{ score: number | null; dureeParQuestion: number | null }>;
  domaineCompetence: string | null;
}

/**
 * Heuristique documentée :
 * - « Je ne comprends pas » dominant → conceptuel ;
 * - indices demandés → méthodologique ;
 * - exemples demandés → contexte ;
 * - échecs répondus en < 10 s par question → attention ;
 * - domaine « calcul / finance / marge / prix » et échecs → calcul.
 */
export function typesDeBlocage(e: EntreeTypesBlocage): TypeBlocage[] {
  const compte: Record<string, number> = {};
  for (const a of e.aides) compte[a.help_type] = (compte[a.help_type] ?? 0) + 1;
  const echecs = e.tentatives.filter((t) => t.score !== null && t.score < SCORE_ECHEC);
  const types = new Set<TypeBlocage>();

  const total = e.aides.length;
  if (total > 0 && (compte.dont_understand ?? 0) >= Math.max(1, total * 0.34)) types.add("conceptuel");
  if ((compte.hint ?? 0) >= 1) types.add("methodologique");
  if ((compte.example ?? 0) >= 1) types.add("contexte");
  if (echecs.some((t) => t.dureeParQuestion !== null && t.dureeParQuestion < 10)) types.add("attention");
  const domaine = (e.domaineCompetence ?? "").toLowerCase();
  if (echecs.length > 0 && /calcul|financ|marge|prix|tarif|chiffr|math|budget/.test(domaine)) types.add("calcul");

  return TYPES_BLOCAGE.filter((t) => types.has(t));
}

export type Tendance = "hausse" | "baisse" | "stable";

/** Tendance sur les trois derniers scores (±0,05). */
export function tendance(scores: number[]): Tendance {
  const derniers = scores.filter((s) => Number.isFinite(s)).slice(-3);
  if (derniers.length < 2) return "stable";
  const delta = derniers[derniers.length - 1] - derniers[0];
  if (delta > 0.05) return "hausse";
  if (delta < -0.05) return "baisse";
  return "stable";
}

export const TENDANCE_LABELS: Record<Tendance, string> = {
  hausse: "en hausse",
  baisse: "en baisse",
  stable: "stable",
};

export const TYPES_EXERCICE = ["base", "remediation", "consolidation", "challenge", "quick_qcm"] as const;
export type TypeExercice = (typeof TYPES_EXERCICE)[number];

export const TYPE_EXERCICE_LABELS: Record<TypeExercice, string> = {
  base: "Exercice de base",
  remediation: "Exercice de remédiation",
  consolidation: "Exercice de consolidation",
  challenge: "Exercice de challenge",
  quick_qcm: "QCM rapide",
};

/** Type d'exercice recommandé selon la bande et le niveau atteint (addendum §5.2). */
export function typeExerciceRecommande(bande: Bande, niveauMaitrise: string | null): TypeExercice {
  if (bande === "critique" || bande === "important") return "base";
  if (bande === "modere") return "remediation";
  if (bande === "leger") return "consolidation";
  if (niveauMaitrise === "advanced" || niveauMaitrise === "elite") return "challenge";
  if (niveauMaitrise === "operational") return "consolidation";
  return "base";
}

export const XP_EXERCICE: Record<TypeExercice, number> = {
  base: 20,
  remediation: 30,
  consolidation: 40,
  challenge: 60,
  quick_qcm: 20,
};
export const BONUS_RAPIDITE_QCM = 10;
export const SEUIL_VALIDATION_EXERCICE = 80;

export function xpExercice(type: TypeExercice, scorePourcent: number, rapide = false): number {
  if (scorePourcent < SEUIL_VALIDATION_EXERCICE) return 0;
  return XP_EXERCICE[type] + (type === "quick_qcm" && rapide ? BONUS_RAPIDITE_QCM : 0);
}

export const XP_REDUCTION_BLOCAGE = 50;
export const REDUCTION_RECOMPENSEE = 0.2;

/** +50 XP quand le score de blocage baisse d'au moins 0,2. */
export function reductionRecompensee(avant: number | null, apres: number | null): number {
  if (avant === null || apres === null) return 0;
  // Arrondi au centième : 0,7 − 0,5 vaut 0,19999… en flottant.
  const baisse = Math.round((avant - apres) * 100) / 100;
  return baisse >= REDUCTION_RECOMPENSEE ? XP_REDUCTION_BLOCAGE : 0;
}

export const MAX_AIDES_PAR_JOUR = 30;
export const MAX_GENERATIONS_PAR_JOUR = 5;

export function peutDemanderAide(nbAujourdhui: number): boolean {
  return nbAujourdhui < MAX_AIDES_PAR_JOUR;
}

export function peutGenerer(nbAujourdhui: number): boolean {
  return nbAujourdhui < MAX_GENERATIONS_PAR_JOUR;
}

export type TypeRecommandation = "exercise" | "review" | "trainer_meeting" | "peer_help" | "situation";

export interface Recommandation {
  type: TypeRecommandation;
  competencyId: string | null;
  titre: string;
  detail: string;
  priorite: number;
}

export interface CompetenceSuivie {
  competencyId: string;
  nom: string;
  score: number | null;
  bande: Bande;
  niveau: string | null;
  exercicesEnAttente: number;
  tendance: Tendance;
}

/** Recommandations priorisées (1 = la plus urgente), au plus 5. */
export function construireRecommandations(competences: CompetenceSuivie[]): Recommandation[] {
  const liste: Recommandation[] = [];
  for (const c of competences) {
    if (c.bande === "critique") {
      liste.push({ type: "trainer_meeting", competencyId: c.competencyId, titre: `Faire le point avec votre formateur sur « ${c.nom} »`, detail: "Le score de blocage est critique : un échange de dix minutes vaut mieux que dix exercices.", priorite: 1 });
    }
    if (c.exercicesEnAttente > 0) {
      liste.push({ type: "exercise", competencyId: c.competencyId, titre: `Terminer ${c.exercicesEnAttente} exercice${c.exercicesEnAttente > 1 ? "s" : ""} sur « ${c.nom} »`, detail: "Ils ont été générés pour vos blocages précis.", priorite: 2 });
    } else if (c.bande === "important" || c.bande === "modere") {
      liste.push({ type: "exercise", competencyId: c.competencyId, titre: `Générer un exercice de ${c.bande === "important" ? "base" : "remédiation"} sur « ${c.nom} »`, detail: "Un exercice ciblé sur votre blocage, corrigé avec explication.", priorite: c.bande === "important" ? 2 : 3 });
    }
    if (c.bande === "important" || c.bande === "critique") {
      liste.push({ type: "peer_help", competencyId: c.competencyId, titre: `Partager votre blocage sur « ${c.nom} » dans l'Entraide`, detail: "Un pair l'a peut-être déjà surmonté.", priorite: 3 });
    }
    if (c.bande === "leger" && c.tendance === "hausse") {
      liste.push({ type: "review", competencyId: c.competencyId, titre: `Réviser les questions manquées sur « ${c.nom} »`, detail: "Le blocage remonte légèrement : une révision suffit souvent.", priorite: 4 });
    }
  }
  return liste.sort((a, b) => a.priorite - b.priorite).slice(0, 5);
}

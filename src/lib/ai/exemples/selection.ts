/**
 * Exemples de référence (few-shot) pour le prompt de plan v2 — lot 25.
 * Logique pure, testée.
 *
 * Les exemples sont des extraits de modules au format v2, rangés dans
 * ce dossier en JSON. Chacun porte son domaine, sa source, son statut
 * et son niveau de confidentialité. Règles :
 * - seuls les exemples `statut: "valide"` ET `confidentialite:
 *   "publiable"` sont injectés en production ;
 * - les exemples `a_valider_par_yakin` ne le sont que sur demande
 *   explicite (`LLM_EXEMPLES=brouillons`, réservé au banc d'essai) ;
 * - on préfère un domaine DIFFÉRENT du sujet demandé (les exemples
 *   montrent la structure, pas le contenu) et, pour un sujet non
 *   commercial, on écarte les exemples commerciaux (ne pas contaminer
 *   un module RH avec de la vente) ;
 * - un budget de jetons borne la taille injectée.
 */

import managementEntretienAnnuel from "./management-entretien-annuel.json";
import restaurationHaccp from "./restauration-haccp.json";
import venteAccueilBoutique from "./vente-accueil-boutique.json";

export type StatutExemple = "valide" | "a_valider_par_yakin";
export type ConfidentialiteExemple = "publiable" | "interne" | "confidentiel";

export interface ExempleReference {
  id: string;
  domaine: string;
  titre: string;
  source: string;
  statut: StatutExemple;
  confidentialite: ConfidentialiteExemple;
  /** Le sujet de l'exemple est-il commercial (vente, retail…) ? */
  commercial: boolean;
  /** Extrait au format du prompt v2 (compétences, modules, leçons, activités). */
  extrait: unknown;
}

/** Exemples livrés avec l'application (ordre sans importance). */
export const EXEMPLES: ExempleReference[] = [
  managementEntretienAnnuel as ExempleReference,
  restaurationHaccp as ExempleReference,
  venteAccueilBoutique as ExempleReference,
];

/** LLM_EXEMPLES : on (défaut, validés seulement) | off | brouillons (banc d'essai). */
export type ModeExemples = "on" | "off" | "brouillons";

export function analyserModeExemples(valeur: string): ModeExemples {
  const v = valeur.trim().toLowerCase();
  if (v === "off" || v === "false" || v === "0" || v === "non") return "off";
  if (v === "brouillons" || v === "tous" || v === "all") return "brouillons";
  return "on";
}

/** Budget de jetons par défaut consacré aux exemples. */
export const BUDGET_EXEMPLES_DEFAUT = 6000;

/**
 * Estimation grossière du nombre de jetons d'un texte français : environ
 * 3,5 caractères par jeton, arrondie vers le haut (prudente).
 */
export function estimerJetons(texte: string): number {
  return Math.ceil(texte.length / 3.5);
}

const MOTS_COMMERCIAUX =
  /\b(ventes?|vendeurs?|vendeuses?|vendre|commerciale?s?|commerciaux|commerce|retail|boutiques?|magasins?|caisses?|caissi[eè]re?s?|luxe|client[èe]les?|relation client|merchandising|n[ée]gociation commerciale|prospection|upsell|cross[- ]?selling|up[- ]?selling)\b/i;

/** Le domaine ou le sujet décrit relève-t-il de la vente / du commerce ? */
export function estCommercial(texte: string | null | undefined): boolean {
  return Boolean(texte && MOTS_COMMERCIAUX.test(texte));
}

function normaliser(d: string | null | undefined): string {
  return (d ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim();
}

export interface OptionsSelection {
  exemples?: ExempleReference[];
  mode?: ModeExemples;
  /** Nombre maximal d'exemples injectés (défaut 2). */
  maximum?: number;
}

/**
 * Choisit les exemples à injecter pour un sujet (`domaine` : secteur ou
 * sujet du brief, peut être vide) dans un budget de jetons.
 */
export function choisirExemples(
  domaine: string | null | undefined,
  budgetJetons: number = BUDGET_EXEMPLES_DEFAUT,
  options: OptionsSelection = {}
): ExempleReference[] {
  const mode = options.mode ?? "on";
  if (mode === "off" || budgetJetons <= 0) return [];
  const maximum = options.maximum ?? 2;
  const sujetCommercial = estCommercial(domaine);
  const domaineSujet = normaliser(domaine);

  const candidats = (options.exemples ?? EXEMPLES).filter(
    (e) => e.confidentialite === "publiable" && (e.statut === "valide" || mode === "brouillons")
  );

  const score = (e: ExempleReference): number => {
    let s = 0;
    const memeDomaine = domaineSujet !== "" && (domaineSujet.includes(normaliser(e.domaine)) || normaliser(e.domaine).includes(domaineSujet));
    if (!memeDomaine) s += 2; // montrer la structure sans donner le contenu du sujet
    if (!sujetCommercial && e.commercial) s -= 10; // jamais de vente sur un sujet non commercial
    if (sujetCommercial && e.commercial) s += 1;
    if (e.statut === "valide") s += 1;
    return s;
  };

  const ordonnes = candidats
    .map((e, i) => ({ e, i, s: score(e) }))
    .sort((a, b) => b.s - a.s || a.i - b.i);

  const retenus: ExempleReference[] = [];
  let reste = budgetJetons;
  for (const { e, s } of ordonnes) {
    if (retenus.length >= maximum) break;
    if (!sujetCommercial && e.commercial && s < 0) continue;
    const cout = estimerJetons(formaterExemple(e, retenus.length + 1));
    if (cout > reste) continue;
    retenus.push(e);
    reste -= cout;
  }
  return retenus;
}

/** Un exemple formaté pour le prompt : en-tête sobre + JSON compact. */
export function formaterExemple(exemple: ExempleReference, numero: number): string {
  return `### Exemple ${numero} — domaine : ${exemple.domaine} — « ${exemple.titre} »\n${JSON.stringify(exemple.extrait, null, 1)}`;
}

/**
 * Bloc d'exemples prêt à être injecté dans le prompt v2 (voir
 * `construirePromptPlanV2`, qui ajoute la consigne de ne pas reprendre
 * le contenu). Chaîne vide s'il n'y a rien à injecter.
 */
export function formaterExemples(exemples: ExempleReference[]): string {
  return exemples.map((e, i) => formaterExemple(e, i + 1)).join("\n\n");
}

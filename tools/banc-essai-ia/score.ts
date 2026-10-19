/**
 * Fonctions de score et de rapport du banc d'essai IA — logique pure,
 * testée (`tests/banc-essai.test.ts`). Aucun accès réseau ni fichier.
 */

import type { ResultatGeneration } from "@/lib/ai/schema";
import type { Probleme } from "@/lib/ai/controle-pedagogique";

/* ------------------------------------------------------------------
   Configuration du banc (fichiers JSON du dossier)
   ------------------------------------------------------------------ */

export interface ConfigurationBanc {
  id: string;
  libelle: string;
  fournisseur: string;
  modele: string;
  /** Nom de la variable d'environnement qui porte la clé. */
  cle_env: string;
  /** Variable facultative pour une URL de base (proxy, hébergeur hors Chine). */
  base_url_env?: string;
  exemples: "on" | "off" | "brouillons";
  thinking: "auto" | "on" | "off";
  actif: boolean;
  commentaire?: string;
}

export interface BriefBanc {
  id: string;
  domaine: string;
  sujet: string;
  public_cible?: string;
  secteur?: string;
  contexte?: string;
  duree?: string;
  format?: string;
  niveau?: string;
  notions_obligatoires?: string;
}

export interface Tarif {
  /** USD par million de jetons en entrée (cache manqué, heure pleine). */
  entree_par_million: number;
  /** USD par million de jetons en sortie (heure pleine). */
  sortie_par_million: number;
  note?: string;
}

export interface Tarifs {
  date: string;
  devise: string;
  sources: string[];
  modeles: Record<string, Tarif>;
  hypotheses: {
    /** Jetons de sortie supposés par génération pour l'estimation préalable. */
    sortie_jetons: number;
    /** Probabilité d'une relance de réparation (second appel). */
    probabilite_reparation: number;
  };
}

/** Tarif d'un modèle (clé exacte, puis préfixe le plus long), ou null. */
export function tarifPour(tarifs: Tarifs, modele: string): Tarif | null {
  if (tarifs.modeles[modele]) return tarifs.modeles[modele];
  const cles = Object.keys(tarifs.modeles)
    .filter((k) => modele.startsWith(k))
    .sort((a, b) => b.length - a.length);
  return cles.length > 0 ? tarifs.modeles[cles[0]] : null;
}

/** Coût en USD ; null si le tarif ou les jetons manquent. */
export function estimerCout(tarif: Tarif | null, inputTokens: number | null, outputTokens: number | null): number | null {
  if (!tarif || inputTokens === null || outputTokens === null) return null;
  return (inputTokens * tarif.entree_par_million + outputTokens * tarif.sortie_par_million) / 1_000_000;
}

/* ------------------------------------------------------------------
   Estimation avant lancement
   ------------------------------------------------------------------ */

export interface LigneEstimation {
  configuration: string;
  brief: string;
  modele: string;
  entreeJetons: number;
  sortieJetons: number;
  cout: number | null;
}

export function estimerAvantLancement(
  couples: Array<{ configuration: ConfigurationBanc; brief: BriefBanc; entreeJetons: number }>,
  tarifs: Tarifs
): { lignes: LigneEstimation[]; total: number | null; inconnus: string[] } {
  const facteur = 1 + tarifs.hypotheses.probabilite_reparation;
  const lignes: LigneEstimation[] = couples.map(({ configuration, brief, entreeJetons }) => {
    const tarif = tarifPour(tarifs, configuration.modele);
    const entree = Math.round(entreeJetons * facteur);
    const sortie = Math.round(tarifs.hypotheses.sortie_jetons * facteur);
    return {
      configuration: configuration.id,
      brief: brief.id,
      modele: configuration.modele,
      entreeJetons: entree,
      sortieJetons: sortie,
      cout: estimerCout(tarif, entree, sortie),
    };
  });
  const inconnus = [...new Set(lignes.filter((l) => l.cout === null).map((l) => l.modele))];
  const total = lignes.some((l) => l.cout === null) && lignes.every((l) => l.cout === null)
    ? null
    : lignes.reduce((s, l) => s + (l.cout ?? 0), 0);
  return { lignes, total, inconnus };
}

/* ------------------------------------------------------------------
   Statistiques d'un plan généré
   ------------------------------------------------------------------ */

export interface StatistiquesPlan {
  competences: number;
  modules: number;
  lecons: number;
  activites: number;
  quiz: number;
  questions: number;
  mediaBriefs: number;
  /** Nombre moyen d'activités d'exercice par leçon (1 décimale). */
  exercicesParLecon: number;
  leconsSansCompetence: number;
  mots: number;
}

export function statistiquesPlan(r: ResultatGeneration): StatistiquesPlan {
  let lecons = 0;
  let activites = 0;
  let quiz = 0;
  let questions = 0;
  let mediaBriefs = 0;
  let leconsSansCompetence = 0;
  let mots = 0;
  for (const m of r.modules) {
    for (const l of m.lessons) {
      lecons += 1;
      activites += l.activities.length;
      if (l.media_brief) mediaBriefs += 1;
      if (l.competency_refs.length === 0) leconsSansCompetence += 1;
      mots += l.text.split(/\s+/).filter(Boolean).length;
      for (const a of l.activities) {
        if (a.type === "quiz") quiz += 1;
        questions += a.questions.length;
        if (a.media_brief) mediaBriefs += 1;
        mots += `${a.instructions} ${a.expected_outcome} ${a.evaluation}`.split(/\s+/).filter(Boolean).length;
      }
    }
  }
  return {
    competences: r.competencies.length,
    modules: r.modules.length,
    lecons,
    activites,
    quiz,
    questions,
    mediaBriefs,
    exercicesParLecon: lecons === 0 ? 0 : Math.round((activites / lecons) * 10) / 10,
    leconsSansCompetence,
    mots,
  };
}

/* ------------------------------------------------------------------
   Rapport
   ------------------------------------------------------------------ */

export const CRITERES_NOTATION = [
  "Exactitude",
  "Adéquation au public",
  "Lien avec les compétences",
  "Qualité du français",
  "Pertinence des exemples",
  "Exercices",
] as const;

export interface EntreeRapport {
  configuration: ConfigurationBanc;
  brief: BriefBanc;
  ok: boolean;
  erreur: string | null;
  dureeMs: number;
  inputTokens: number | null;
  outputTokens: number | null;
  cout: number | null;
  appels: number;
  reparee: boolean;
  erreursInitiales: Probleme[];
  erreursFinales: Probleme[];
  avertissements: Probleme[];
  statistiques: StatistiquesPlan | null;
  /** Nom du fichier JSON détaillé. */
  fichier: string;
}

export function formaterDuree(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const s = ms / 1000;
  return s < 60 ? `${s.toFixed(1)} s` : `${Math.floor(s / 60)} min ${Math.round(s % 60)} s`;
}

export function formaterUsd(n: number | null): string {
  return n === null ? "n/d" : `${n.toFixed(4)} $`;
}

function cellule(texte: string): string {
  return texte.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function compterCodes(problemes: Probleme[]): string {
  if (problemes.length === 0) return "—";
  const compte = new Map<string, number>();
  for (const p of problemes) compte.set(p.code, (compte.get(p.code) ?? 0) + 1);
  return [...compte.entries()].map(([c, n]) => (n > 1 ? `${c} ×${n}` : c)).join(", ");
}

/** Moyennes par configuration (toutes briefs confondues). */
export function synthesePourConfiguration(entrees: EntreeRapport[]): Array<{
  configuration: string;
  reussites: number;
  total: number;
  dureeMoyenneMs: number;
  coutTotal: number | null;
  reparations: number;
  avertissementsMoyens: number;
}> {
  const parConfig = new Map<string, EntreeRapport[]>();
  for (const e of entrees) {
    const liste = parConfig.get(e.configuration.id) ?? [];
    liste.push(e);
    parConfig.set(e.configuration.id, liste);
  }
  return [...parConfig.entries()].map(([configuration, liste]) => ({
    configuration,
    reussites: liste.filter((e) => e.ok).length,
    total: liste.length,
    dureeMoyenneMs: Math.round(liste.reduce((s, e) => s + e.dureeMs, 0) / liste.length),
    coutTotal: liste.every((e) => e.cout === null) ? null : liste.reduce((s, e) => s + (e.cout ?? 0), 0),
    reparations: liste.filter((e) => e.reparee).length,
    avertissementsMoyens: Math.round((liste.reduce((s, e) => s + e.avertissements.length, 0) / liste.length) * 10) / 10,
  }));
}

export interface MetaRapport {
  date: string;
  simulation: boolean;
  tarifsDate: string;
  promptVersion: string;
  bornes: { min: number; max: number };
}

/** Rapport Markdown : tableau comparatif + emplacement pour la notation humaine. */
export function construireRapport(entrees: EntreeRapport[], meta: MetaRapport): string {
  const lignes: string[] = [];
  lignes.push(`# Banc d'essai IA — ${meta.date}${meta.simulation ? " (SIMULATION, sans appel réseau)" : ""}`);
  lignes.push("");
  lignes.push(
    `Prompt : \`${meta.promptVersion}\` · bornes d'exercices par leçon : ${meta.bornes.min}–${meta.bornes.max} · tarifs du ${meta.tarifsDate} (heure pleine, cache manqué) · ` +
      `${entrees.length} génération(s).`
  );
  lignes.push("");
  lignes.push("Briefs fictifs uniquement : aucune donnée d'organisation n'a été envoyée.");
  lignes.push("");

  lignes.push("## 1. Synthèse par configuration");
  lignes.push("");
  lignes.push("| Configuration | Réussites | Durée moyenne | Coût total | Réparations | Avertissements moyens |");
  lignes.push("|---|---|---|---|---|---|");
  for (const s of synthesePourConfiguration(entrees)) {
    lignes.push(
      `| ${cellule(s.configuration)} | ${s.reussites}/${s.total} | ${formaterDuree(s.dureeMoyenneMs)} | ${formaterUsd(s.coutTotal)} | ${s.reparations} | ${s.avertissementsMoyens} |`
    );
  }
  lignes.push("");

  const briefs = [...new Map(entrees.map((e) => [e.brief.id, e.brief])).values()];
  lignes.push("## 2. Détail par brief");
  for (const b of briefs) {
    lignes.push("");
    lignes.push(`### ${b.id} — ${b.sujet}`);
    lignes.push("");
    lignes.push("| Configuration | Résultat | Durée | Jetons (entrée / sortie) | Coût | Appels | Réparation | Erreurs bloquantes initiales | Avertissements | Structure | Fichier |");
    lignes.push("|---|---|---|---|---|---|---|---|---|---|---|");
    for (const e of entrees.filter((x) => x.brief.id === b.id)) {
      const structure = e.statistiques
        ? `${e.statistiques.competences} comp. · ${e.statistiques.modules} mod. · ${e.statistiques.lecons} leçons · ${e.statistiques.activites} act. (${e.statistiques.exercicesParLecon}/leçon) · ${e.statistiques.questions} questions · ${e.statistiques.mediaBriefs} médias · ${e.statistiques.mots} mots`
        : "—";
      lignes.push(
        `| ${cellule(e.configuration.id)} | ${e.ok ? "✅" : `❌ ${cellule((e.erreur ?? "").slice(0, 120))}`} | ${formaterDuree(e.dureeMs)} | ${e.inputTokens ?? "n/d"} / ${e.outputTokens ?? "n/d"} | ${formaterUsd(e.cout)} | ${e.appels} | ${e.reparee ? "oui" : "non"} | ${cellule(compterCodes(e.erreursInitiales))} | ${cellule(compterCodes(e.avertissements))} | ${cellule(structure)} | \`${e.fichier}\` |`
      );
    }
  }
  lignes.push("");

  lignes.push("## 3. Notation humaine (à remplir, voir `grille.md`)");
  lignes.push("");
  lignes.push("Chaque critère est noté de 1 à 5 par un relecteur pédagogique qui a lu le JSON produit. Total sur 30.");
  lignes.push("");
  lignes.push(`| Brief | Configuration | ${CRITERES_NOTATION.join(" | ")} | Total /30 | Relecteur | Remarques |`);
  lignes.push(`|---|---|${CRITERES_NOTATION.map(() => "---").join("|")}|---|---|---|`);
  for (const e of entrees) {
    lignes.push(`| ${cellule(e.brief.id)} | ${cellule(e.configuration.id)} | ${CRITERES_NOTATION.map(() => " ").join(" | ")} |  |  |  |`);
  }
  lignes.push("");
  lignes.push("## 4. Lecture");
  lignes.push("");
  lignes.push("- « Réussite » = JSON valide ET aucune erreur bloquante du contrôle pédagogique (après au plus une réparation).");
  lignes.push("- Les coûts sont estimés à partir des jetons renvoyés par le fournisseur et des tarifs du fichier `tarifs.json` ; ils ne remplacent pas la facture.");
  lignes.push("- Le classement final combine ces mesures et la notation humaine : un modèle rapide et bon marché qui produit des exercices hors sujet ne gagne pas.");
  return lignes.join("\n");
}

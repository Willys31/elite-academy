import { describe, expect, it } from "vitest";
import { analyserDotenv } from "../tools/banc-essai-ia/dotenv";
import {
  construireRapport,
  CRITERES_NOTATION,
  estimerAvantLancement,
  estimerCout,
  formaterDuree,
  formaterUsd,
  statistiquesPlan,
  synthesePourConfiguration,
  tarifPour,
  type BriefBanc,
  type ConfigurationBanc,
  type EntreeRapport,
  type Tarifs,
} from "../tools/banc-essai-ia/score";
import { validerResultat } from "@/lib/ai/schema";
import { genererSimulation } from "@/lib/ai/simulation";
import { extraireJson } from "@/lib/ai/json";
import fs from "node:fs";
import path from "node:path";

/* ------------------------------------------------------------------
   Lot 25 – banc d'essai : fonctions de score (aucun appel réseau)
   ------------------------------------------------------------------ */

const TARIFS: Tarifs = {
  date: "2026-10-16",
  devise: "USD",
  sources: [],
  modeles: {
    "deepseek-flash": { entree_par_million: 0.3, sortie_par_million: 1.2 },
    "deepseek-v4-pro": { entree_par_million: 1.32, sortie_par_million: 3.96 },
  },
  hypotheses: { sortie_jetons: 10000, probabilite_reparation: 0.5 },
};

const CONFIG: ConfigurationBanc = {
  id: "flash",
  libelle: "Flash",
  fournisseur: "deepseek",
  modele: "deepseek-flash",
  cle_env: "DEEPSEEK_API_KEY",
  exemples: "off",
  thinking: "auto",
  actif: true,
};
const BRIEF: BriefBanc = { id: "b1", domaine: "management", sujet: "Entretien annuel", secteur: "management" };

describe("tarifs et coûts", () => {
  it("trouve un tarif exact ou par préfixe, sinon null", () => {
    expect(tarifPour(TARIFS, "deepseek-flash")?.sortie_par_million).toBe(1.2);
    expect(tarifPour(TARIFS, "deepseek-v4-pro-0813")?.entree_par_million).toBe(1.32);
    expect(tarifPour(TARIFS, "gpt-5")).toBeNull();
  });

  it("calcule le coût en USD à partir des jetons", () => {
    expect(estimerCout(TARIFS.modeles["deepseek-flash"], 1_000_000, 1_000_000)).toBeCloseTo(1.5);
    expect(estimerCout(TARIFS.modeles["deepseek-flash"], 10_000, 5_000)).toBeCloseTo(0.003 + 0.006);
    expect(estimerCout(null, 10, 10)).toBeNull();
    expect(estimerCout(TARIFS.modeles["deepseek-flash"], null, 10)).toBeNull();
  });

  it("estime le coût avant lancement avec la marge de réparation", () => {
    const e = estimerAvantLancement([{ configuration: CONFIG, brief: BRIEF, entreeJetons: 4000 }], TARIFS);
    expect(e.lignes[0].entreeJetons).toBe(6000);
    expect(e.lignes[0].sortieJetons).toBe(15000);
    expect(e.total).toBeCloseTo((6000 * 0.3 + 15000 * 1.2) / 1_000_000);
    expect(e.inconnus).toEqual([]);
  });

  it("signale les modèles sans tarif", () => {
    const e = estimerAvantLancement([{ configuration: { ...CONFIG, modele: "inconnu" }, brief: BRIEF, entreeJetons: 100 }], TARIFS);
    expect(e.total).toBeNull();
    expect(e.inconnus).toEqual(["inconnu"]);
  });

  it("le fichier tarifs.json livré est daté et couvre les modèles des configurations", () => {
    const racine = path.resolve(__dirname, "..", "tools", "banc-essai-ia");
    const tarifs = JSON.parse(fs.readFileSync(path.join(racine, "tarifs.json"), "utf8")) as Tarifs;
    const configs = JSON.parse(fs.readFileSync(path.join(racine, "configurations.json"), "utf8")) as { configurations: ConfigurationBanc[] };
    expect(tarifs.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    for (const c of configs.configurations) expect(tarifPour(tarifs, c.modele), c.modele).not.toBeNull();
    expect(configs.configurations.filter((c) => c.actif).length).toBeGreaterThanOrEqual(6);
    const briefs = fs.readdirSync(path.join(racine, "briefs")).filter((f) => f.endsWith(".json"));
    expect(briefs).toHaveLength(3);
  });
});

describe("statistiques d'un plan", () => {
  it("compte compétences, modules, leçons, activités, questions et médias", () => {
    const a = validerResultat(extraireJson(genererSimulation({ sujet: "Gestion des conflits internes" })));
    if (!a.ok) throw new Error(a.erreur);
    const s = statistiquesPlan(a.resultat);
    expect(s.competences).toBe(2);
    expect(s.modules).toBe(2);
    expect(s.lecons).toBe(4);
    expect(s.activites).toBe(4);
    expect(s.quiz).toBe(4);
    expect(s.questions).toBe(4);
    expect(s.exercicesParLecon).toBe(1);
    expect(s.leconsSansCompetence).toBe(0);
    expect(s.mots).toBeGreaterThan(50);
  });
});

function entree(extra: Partial<EntreeRapport> = {}): EntreeRapport {
  return {
    configuration: CONFIG,
    brief: BRIEF,
    ok: true,
    erreur: null,
    dureeMs: 12_300,
    inputTokens: 5000,
    outputTokens: 9000,
    cout: 0.0123,
    appels: 1,
    reparee: false,
    erreursInitiales: [],
    erreursFinales: [],
    avertissements: [],
    statistiques: { competences: 3, modules: 2, lecons: 5, activites: 7, quiz: 3, questions: 9, mediaBriefs: 1, exercicesParLecon: 1.4, leconsSansCompetence: 0, mots: 1200 },
    fichier: "flash__b1.json",
    ...extra,
  };
}

describe("rapport", () => {
  it("formate durées et montants", () => {
    expect(formaterDuree(800)).toBe("800 ms");
    expect(formaterDuree(12_340)).toBe("12.3 s");
    expect(formaterDuree(125_000)).toBe("2 min 5 s");
    expect(formaterUsd(null)).toBe("n/d");
    expect(formaterUsd(0.01234)).toBe("0.0123 $");
  });

  it("synthétise par configuration", () => {
    const pro = { ...CONFIG, id: "pro", modele: "deepseek-v4-pro" };
    const s = synthesePourConfiguration([
      entree(),
      entree({ ok: false, erreur: "x", cout: 0.02, reparee: true, avertissements: [{ code: "SITUATION_INCONNUE", chemin: "", message: "" }] }),
      entree({ configuration: pro, cout: null }),
    ]);
    expect(s).toHaveLength(2);
    expect(s[0]).toMatchObject({ configuration: "flash", reussites: 1, total: 2, reparations: 1, avertissementsMoyens: 0.5 });
    expect(s[0].coutTotal).toBeCloseTo(0.0323);
    expect(s[1].coutTotal).toBeNull();
  });

  it("produit un rapport Markdown lisible avec la grille de notation", () => {
    const r = construireRapport(
      [
        entree(),
        entree({
          ok: false,
          erreur: "Le plan généré ne respecte pas…\n– détail",
          reparee: true,
          appels: 2,
          erreursInitiales: [
            { code: "ACTIVITE_SANS_COMPETENCE", chemin: "a", message: "m" },
            { code: "ACTIVITE_SANS_COMPETENCE", chemin: "b", message: "m" },
          ],
          statistiques: null,
        }),
      ],
      { date: "2026-10-16", simulation: false, tarifsDate: "2026-10-16", promptVersion: "plan-formation/v2", bornes: { min: 1, max: 3 } }
    );
    expect(r).toContain("# Banc d'essai IA — 2026-10-16");
    expect(r).toContain("## 1. Synthèse par configuration");
    expect(r).toContain("| flash | 1/2 |");
    expect(r).toContain("### b1 — Entretien annuel");
    expect(r).toContain("ACTIVITE_SANS_COMPETENCE ×2");
    expect(r).toContain("3 comp. · 2 mod. · 5 leçons · 7 act. (1.4/leçon)");
    expect(r).toContain("## 3. Notation humaine");
    for (const c of CRITERES_NOTATION) expect(r).toContain(c);
    expect(r).toContain("Briefs fictifs uniquement");
    expect(r).not.toContain("\n– détail");
  });

  it("mentionne la simulation dans le titre", () => {
    const r = construireRapport([entree()], { date: "d", simulation: true, tarifsDate: "d", promptVersion: "v", bornes: { min: 1, max: 3 } });
    expect(r).toContain("(SIMULATION, sans appel réseau)");
  });
});

describe("analyserDotenv", () => {
  it("lit les formes courantes", () => {
    const v = analyserDotenv(`# commentaire
DEEPSEEK_API_KEY=sk-abc
export GEMINI_API_KEY="AIza xyz"
LLM_MODEL='deepseek-flash'
VIDE=
AVEC_COMMENTAIRE=valeur # note
PAS_UNE_LIGNE
`);
    expect(v).toEqual({
      DEEPSEEK_API_KEY: "sk-abc",
      GEMINI_API_KEY: "AIza xyz",
      LLM_MODEL: "deepseek-flash",
      VIDE: "",
      AVEC_COMMENTAIRE: "valeur",
    });
  });
});

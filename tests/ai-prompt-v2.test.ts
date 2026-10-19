import { describe, expect, it } from "vitest";
import { construirePromptPlan, PROMPT_VERSION, SYSTEM_PROMPT, type BriefGeneration } from "@/lib/ai/prompts";
import {
  analyserVersionPromptPlan,
  BORNES_EXERCICES_DEFAUT,
  construirePromptPlanV2,
  construireSystemPlanV2,
  PROMPT_VERSION_PLAN_V2,
  promptPlan,
  SYSTEM_PLAN_V2,
  TYPES_SITUATION,
} from "@/lib/ai/prompts-plan-v2";

/* ------------------------------------------------------------------
   Lot 25 – prompt méthodologique v2
   ------------------------------------------------------------------ */

const BRIEF: BriefGeneration = {
  sujet: "Conduire un entretien annuel d'évaluation",
  public_cible: "managers de proximité",
  secteur: "management",
  duree: "1 jour",
  niveau: "Opérationnel",
};

describe("système v2 – méthode de structuration", () => {
  it("porte une nouvelle version et laisse la v1 intacte", () => {
    expect(PROMPT_VERSION_PLAN_V2).toBe("plan-formation/v2");
    expect(PROMPT_VERSION).toBe("plan-formation/v1");
    expect(SYSTEM_PROMPT).not.toContain("competency_refs");
  });

  it("reprend les règles déjà présentes (multi-domaines, méthodes commerciales, brouillon, warnings)", () => {
    expect(SYSTEM_PLAN_V2).toContain("Ne suppose jamais que le sujet concerne la vente");
    expect(SYSTEM_PLAN_V2).toContain("SONCASE, CAB, vente additionnelle");
    expect(SYSTEM_PLAN_V2).toContain("brouillon jusqu'à validation");
    expect(SYSTEM_PLAN_V2).toContain('alerte dans "warnings"');
  });

  it("décrit la méthode maison : compétences observables, niveaux, répartition, bon exercice, étude de cas", () => {
    expect(SYSTEM_PLAN_V2).toContain("COMPÉTENCES OBSERVABLES");
    expect(SYSTEM_PLAN_V2).toContain("verbe d'action");
    for (const n of ["fundamentals", "operational", "advanced", "elite"]) expect(SYSTEM_PLAN_V2).toContain(`"${n}"`);
    expect(SYSTEM_PLAN_V2).toContain("5 à 10 %");
    expect(SYSTEM_PLAN_V2).toContain("30 à 40 %");
    expect(SYSTEM_PLAN_V2).toContain("BON EXERCICE");
    expect(SYSTEM_PLAN_V2).toContain("ÉTUDE DE CAS");
    expect(SYSTEM_PLAN_V2).toContain("SIMULATION");
  });

  it("impose les nouveaux champs du schéma de sortie", () => {
    expect(SYSTEM_PLAN_V2).toContain('"competency_refs"');
    expect(SYSTEM_PLAN_V2).toContain('"situation_type"');
    expect(SYSTEM_PLAN_V2).toContain('"media_brief"');
    expect(SYSTEM_PLAN_V2).toContain('"activities"');
    expect(SYSTEM_PLAN_V2).toContain('"level"');
    for (const t of TYPES_SITUATION) expect(SYSTEM_PLAN_V2).toContain(`"${t}"`);
  });

  it("précise que les médias sont décrits, jamais produits", () => {
    expect(SYSTEM_PLAN_V2).toContain("tu ne produis aucun média");
  });

  it("demande des alertes lisibles par un relecteur, sans jargon technique", () => {
    expect(SYSTEM_PLAN_V2).toContain("sans jargon technique");
    expect(SYSTEM_PLAN_V2).toContain("sans citer de noms de champs");
  });

  it("contient le mot JSON (exigence du mode JSON de DeepSeek)", () => {
    expect(SYSTEM_PLAN_V2).toMatch(/JSON/);
    expect(construirePromptPlanV2(BRIEF)).toMatch(/JSON/);
  });

  it("injecte les bornes d'exercices par leçon", () => {
    expect(BORNES_EXERCICES_DEFAUT).toEqual({ min: 1, max: 3 });
    expect(SYSTEM_PLAN_V2).toContain("entre 1 et 3 activités d'exercice par leçon");
    expect(construireSystemPlanV2({ min: 2, max: 4 })).toContain("entre 2 et 4 activités");
  });
});

describe("prompt utilisateur v2", () => {
  it("reprend le brief et ses valeurs par défaut", () => {
    const p = construirePromptPlanV2(BRIEF);
    expect(p).toContain("Conduire un entretien annuel");
    expect(p).toContain("managers de proximité");
    expect(p).toContain("Organisation ou marque : non précisé.");
    expect(p).toContain("1 à 3 activités d'exercice par leçon");
    expect(p).not.toContain("EXEMPLES DE RÉFÉRENCE");
  });

  it("ajoute les exemples de référence avec la consigne de ne pas les reprendre", () => {
    const p = construirePromptPlanV2(BRIEF, { exemples: "### Exemple A\n{...}" });
    expect(p).toContain("EXEMPLES DE RÉFÉRENCE");
    expect(p).toContain("NE PAS reprendre");
    expect(p).toContain("### Exemple A");
    expect(p).toContain("FIN DES EXEMPLES");
  });

  it("ignore un bloc d'exemples vide", () => {
    expect(construirePromptPlanV2(BRIEF, { exemples: "   " })).not.toContain("EXEMPLES DE RÉFÉRENCE");
    expect(construirePromptPlanV2(BRIEF, { exemples: null })).not.toContain("EXEMPLES DE RÉFÉRENCE");
  });

  it("applique des bornes personnalisées", () => {
    expect(construirePromptPlanV2(BRIEF, { bornes: { min: 2, max: 5 } })).toContain("2 à 5 activités");
  });
});

describe("sélection de version (LLM_PROMPT_PLAN)", () => {
  it("lit v1 explicitement, v2 sinon", () => {
    expect(analyserVersionPromptPlan("v1")).toBe("v1");
    expect(analyserVersionPromptPlan(" V1 ")).toBe("v1");
    expect(analyserVersionPromptPlan("")).toBe("v2");
    expect(analyserVersionPromptPlan("v3")).toBe("v2");
  });

  it("la v1 reste strictement celle du lot 3", () => {
    const p = promptPlan("v1", { exemples: "ignoré en v1" });
    expect(p.version).toBe(PROMPT_VERSION);
    expect(p.system).toBe(SYSTEM_PROMPT);
    expect(p.prompt(BRIEF)).toBe(construirePromptPlan(BRIEF));
    expect(p.prompt(BRIEF)).not.toContain("ignoré en v1");
  });

  it("la v2 transmet exemples et bornes", () => {
    const p = promptPlan("v2", { exemples: "EXEMPLE X", bornes: { min: 2, max: 2 } });
    expect(p.version).toBe("plan-formation/v2");
    expect(p.system).toContain("entre 2 et 2 activités");
    expect(p.prompt(BRIEF)).toContain("EXEMPLE X");
    expect(p.prompt(BRIEF)).toContain("2 à 2 activités");
  });
});

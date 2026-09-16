import { describe, expect, it } from "vitest";
import {
  aideAutorisee,
  bandeDeBlocage,
  construireRecommandations,
  doitAlerter,
  peutDemanderAide,
  peutGenerer,
  reductionRecompensee,
  scoreDeBlocage,
  tendance,
  typeExerciceRecommande,
  typesDeBlocage,
  xpExercice,
} from "@/lib/tutorat/blocage";

describe("scoreDeBlocage / bandes", () => {
  it("applique la formule et borne à 1", () => {
    expect(scoreDeBlocage({ nbAides: 1, nbReformulations: 1, nbEchecs: 1, nbTentatives: 5 })).toBe(0.6);
    expect(scoreDeBlocage({ nbAides: 5, nbReformulations: 3, nbEchecs: 2, nbTentatives: 2 })).toBe(1);
    expect(scoreDeBlocage({ nbAides: 0, nbReformulations: 0, nbEchecs: 0, nbTentatives: 3 })).toBe(0);
  });

  it("ne mesure rien sans tentative", () => {
    expect(scoreDeBlocage({ nbAides: 4, nbReformulations: 0, nbEchecs: 0, nbTentatives: 0 })).toBeNull();
    expect(bandeDeBlocage(null).bande).toBe("aucun");
  });

  it("classe dans les cinq bandes de l'addendum", () => {
    expect(bandeDeBlocage(0.2).bande).toBe("aucun");
    expect(bandeDeBlocage(0.21).bande).toBe("leger");
    expect(bandeDeBlocage(0.5).bande).toBe("modere");
    expect(bandeDeBlocage(0.7).bande).toBe("important");
    expect(bandeDeBlocage(0.95).bande).toBe("critique");
  });
});

describe("alertes", () => {
  it("alerte au franchissement de 0,6 et réarme sous 0,4", () => {
    expect(doitAlerter(0.5, 0.65, false)).toBe(true);
    expect(doitAlerter(0.65, 0.7, true)).toBe(false);
    expect(doitAlerter(0.3, 0.7, true)).toBe(true);
    expect(doitAlerter(0.9, 0.5, false)).toBe(false);
    expect(doitAlerter(null, null, false)).toBe(false);
  });

  it("l'explication détaillée exige une tentative", () => {
    expect(aideAutorisee("detailed_explanation", false)).toBe(false);
    expect(aideAutorisee("detailed_explanation", true)).toBe(true);
    expect(aideAutorisee("hint", false)).toBe(true);
  });
});

describe("typesDeBlocage", () => {
  it("déduit les types depuis les aides, les échecs rapides et le domaine", () => {
    const t = typesDeBlocage({
      aides: [{ help_type: "dont_understand" }, { help_type: "dont_understand" }, { help_type: "hint" }],
      tentatives: [{ score: 30, dureeParQuestion: 6 }, { score: 90, dureeParQuestion: 40 }],
      domaineCompetence: "Calcul de marge",
    });
    expect(t).toEqual(["conceptuel", "methodologique", "calcul", "attention"]);
  });

  it("ne signale rien sans aide ni échec", () => {
    expect(typesDeBlocage({ aides: [], tentatives: [{ score: 95, dureeParQuestion: 20 }], domaineCompetence: "Vente" })).toEqual([]);
    expect(typesDeBlocage({ aides: [{ help_type: "example" }], tentatives: [], domaineCompetence: null })).toEqual(["contexte"]);
  });
});

describe("tendance / adaptation / XP", () => {
  it("lit la tendance sur les trois derniers scores", () => {
    expect(tendance([0.2, 0.3, 0.5])).toBe("hausse");
    expect(tendance([0.8, 0.6, 0.4])).toBe("baisse");
    expect(tendance([0.5, 0.52])).toBe("stable");
    expect(tendance([0.5])).toBe("stable");
  });

  it("recommande le type d'exercice", () => {
    expect(typeExerciceRecommande("critique", "advanced")).toBe("base");
    expect(typeExerciceRecommande("modere", null)).toBe("remediation");
    expect(typeExerciceRecommande("leger", null)).toBe("consolidation");
    expect(typeExerciceRecommande("aucun", "advanced")).toBe("challenge");
    expect(typeExerciceRecommande("aucun", "operational")).toBe("consolidation");
    expect(typeExerciceRecommande("aucun", null)).toBe("base");
  });

  it("applique le barème XP des exercices", () => {
    expect(xpExercice("base", 100)).toBe(20);
    expect(xpExercice("remediation", 80)).toBe(30);
    expect(xpExercice("challenge", 79)).toBe(0);
    expect(xpExercice("quick_qcm", 100, true)).toBe(30);
    expect(reductionRecompensee(0.7, 0.5)).toBe(50);
    expect(reductionRecompensee(0.7, 0.6)).toBe(0);
    expect(reductionRecompensee(null, 0.2)).toBe(0);
  });

  it("plafonne les demandes journalières", () => {
    expect(peutDemanderAide(29)).toBe(true);
    expect(peutDemanderAide(30)).toBe(false);
    expect(peutGenerer(4)).toBe(true);
    expect(peutGenerer(5)).toBe(false);
  });
});

describe("construireRecommandations", () => {
  it("priorise l'entretien formateur, puis les exercices, et limite à 5", () => {
    const r = construireRecommandations([
      { competencyId: "a", nom: "A", score: 0.9, bande: "critique", niveau: null, exercicesEnAttente: 0, tendance: "stable" },
      { competencyId: "b", nom: "B", score: 0.5, bande: "modere", niveau: null, exercicesEnAttente: 2, tendance: "stable" },
      { competencyId: "c", nom: "C", score: 0.3, bande: "leger", niveau: null, exercicesEnAttente: 0, tendance: "hausse" },
    ]);
    expect(r[0]).toMatchObject({ type: "trainer_meeting", competencyId: "a" });
    expect(r.some((x) => x.type === "exercise" && x.competencyId === "b")).toBe(true);
    expect(r.some((x) => x.type === "review" && x.competencyId === "c")).toBe(true);
    expect(r.length).toBeLessThanOrEqual(5);
    expect(r.map((x) => x.priorite)).toEqual([...r.map((x) => x.priorite)].sort((p, q) => p - q));
  });
});

import { describe, expect, it } from "vitest";
import {
  corrigerExercice,
  lireReponsesExercice,
  separerSolution,
  validerExercicesGeneres,
} from "@/lib/tutorat/exercices";
import { construirePromptAide } from "@/lib/ai/prompts";

const BRUT = {
  exercises: [
    {
      title: "Calculer une marge",
      instructions: "Une seule bonne réponse.",
      type: "remediation",
      difficulty: 7,
      questions: [
        { prompt: "Prix 120, coût 80 : marge ?", options: ["40", "80", "120"], correct_index: 0, explanation: "120 − 80." },
        { prompt: "Sans options", options: ["seule"], correct_index: 0 },
        { prompt: "Index hors bornes", options: ["a", "b"], correct_index: 5 },
      ],
    },
    { title: "", questions: [] },
  ],
};

describe("validerExercicesGeneres", () => {
  it("garde les exercices et questions valides, borne la difficulté", () => {
    const r = validerExercicesGeneres(BRUT);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.exercices).toHaveLength(1);
    expect(r.exercices[0].difficulty).toBe(5);
    expect(r.exercices[0].type).toBe("remediation");
    expect(r.exercices[0].questions).toHaveLength(1);
  });

  it("accepte un tableau nu et refuse le reste", () => {
    expect(validerExercicesGeneres(BRUT.exercises).ok).toBe(true);
    expect(validerExercicesGeneres({ exercises: [] }).ok).toBe(false);
    expect(validerExercicesGeneres("rien").ok).toBe(false);
  });
});

describe("séparation et correction", () => {
  const r = validerExercicesGeneres(BRUT);
  const exercice = r.ok ? r.exercices[0] : null;

  it("ne laisse aucune bonne réponse dans le contenu", () => {
    const { content, solution } = separerSolution(exercice!);
    expect(JSON.stringify(content)).not.toContain("correct_index");
    expect(JSON.stringify(content)).not.toContain("explanation");
    expect(solution.answers[0]).toEqual({ id: "q1", correct_index: 0, explanation: "120 − 80." });
  });

  it("corrige à partir du formulaire", () => {
    const { content, solution } = separerSolution(exercice!);
    const reponses = lireReponsesExercice(content, (cle) => (cle === "q_q1" ? "0" : null));
    const c = corrigerExercice(content, solution, reponses);
    expect(c.scorePourcent).toBe(100);
    expect(c.details[0].explication).toBe("120 − 80.");
  });
});

describe("prompt d'aide – confidentialité de la réponse", () => {
  const question = { enonce: "Quelle est la marge ?", options: ["40", "80", "120"] };
  const tentative = { reponseDonnee: 1, bonneReponse: 0, explication: "SECRET-EXPLICATION" };

  it("n'inclut jamais la bonne réponse pour reformuler, indice, exemple, incompréhension", () => {
    for (const type of ["reformulate", "dont_understand", "hint", "example"] as const) {
      const p = construirePromptAide({ type, ...question, extraitLecon: "…", competence: "Marge", tentative });
      expect(p).not.toContain("SECRET-EXPLICATION");
      expect(p).not.toMatch(/bonne réponse\s*:/i);
    }
  });

  it("l'inclut uniquement pour l'explication détaillée", () => {
    const p = construirePromptAide({ type: "detailed_explanation", ...question, extraitLecon: "…", competence: "Marge", tentative });
    expect(p).toContain("SECRET-EXPLICATION");
  });
});

import { describe, expect, it } from "vitest";
import {
  calculerCompletion,
  corrigerQcm,
  meilleursScoresParActivite,
  niveauDepuisScores,
  type QuestionQcm,
} from "@/lib/courses/progression";

const QUESTIONS: QuestionQcm[] = [
  {
    id: "q1",
    prompt: "Question 1",
    options: ["A", "B", "C"],
    bonneReponse: 1,
    explication: "Parce que B.",
  },
  {
    id: "q2",
    prompt: "Question 2",
    options: ["A", "B"],
    bonneReponse: 0,
    explication: null,
  },
];

describe("corrigerQcm", () => {
  it("calcule le score et le détail par question", () => {
    const r = corrigerQcm(QUESTIONS, { q1: 1, q2: 1 });
    expect(r.scorePourcent).toBe(50);
    expect(r.nbCorrectes).toBe(1);
    expect(r.details[0].correcte).toBe(true);
    expect(r.details[1].correcte).toBe(false);
    expect(r.details[1].bonneReponse).toBe(0);
  });

  it("score 100 quand tout est juste, 0 quand tout est faux", () => {
    expect(corrigerQcm(QUESTIONS, { q1: 1, q2: 0 }).scorePourcent).toBe(100);
    expect(corrigerQcm(QUESTIONS, { q1: 0, q2: 1 }).scorePourcent).toBe(0);
  });

  it("traite une réponse manquante comme incorrecte", () => {
    const r = corrigerQcm(QUESTIONS, { q1: 1 });
    expect(r.scorePourcent).toBe(50);
    expect(r.details[1].reponseDonnee).toBeNull();
    expect(r.details[1].correcte).toBe(false);
  });

  it("gère un QCM vide sans erreur", () => {
    expect(corrigerQcm([], {}).scorePourcent).toBe(0);
  });
});

describe("niveauDepuisScores", () => {
  it("applique le barème documenté", () => {
    expect(niveauDepuisScores([95, 92])).toBe("advanced");
    expect(niveauDepuisScores([80, 75])).toBe("operational");
    expect(niveauDepuisScores([65, 60])).toBe("fundamentals");
    expect(niveauDepuisScores([40, 50])).toBeNull();
  });

  it("ne retourne JAMAIS elite automatiquement, même à 100 %", () => {
    expect(niveauDepuisScores([100, 100, 100])).toBe("advanced");
  });

  it("retourne null sans aucune preuve", () => {
    expect(niveauDepuisScores([])).toBeNull();
  });
});

describe("calculerCompletion", () => {
  it("calcule le pourcentage borné", () => {
    expect(calculerCompletion(2, 4)).toBe(50);
    expect(calculerCompletion(4, 4)).toBe(100);
    expect(calculerCompletion(0, 4)).toBe(0);
    expect(calculerCompletion(5, 4)).toBe(100); // borné
    expect(calculerCompletion(1, 0)).toBe(0); // pas de division par zéro
  });
});

describe("meilleursScoresParActivite", () => {
  it("conserve le meilleur score par activité", () => {
    const scores = meilleursScoresParActivite([
      { activityId: "a", score: 50 },
      { activityId: "a", score: 80 },
      { activityId: "a", score: 60 },
      { activityId: "b", score: 90 },
      { activityId: "c", score: null },
    ]);
    expect(scores.sort((x, y) => x - y)).toEqual([80, 90]);
  });

  it("une tentative ratée après une réussite ne fait pas baisser la maîtrise", () => {
    const avant = niveauDepuisScores(
      meilleursScoresParActivite([{ activityId: "a", score: 92 }])
    );
    const apres = niveauDepuisScores(
      meilleursScoresParActivite([
        { activityId: "a", score: 92 },
        { activityId: "a", score: 30 },
      ])
    );
    expect(apres).toBe(avant);
  });
});

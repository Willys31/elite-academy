import { describe, expect, it } from "vitest";
import {
  bilanPositionnement,
  estTestDePositionnement,
  positionnementAFaire,
  verdictPour,
} from "@/lib/courses/positionnement";

describe("test de positionnement", () => {
  it("reconnaît le marqueur placement dans le contenu de l'activité", () => {
    expect(estTestDePositionnement({ placement: true })).toBe(true);
    expect(estTestDePositionnement({ placement: "oui" })).toBe(false);
    expect(estTestDePositionnement({})).toBe(false);
    expect(estTestDePositionnement(null)).toBe(false);
    expect(estTestDePositionnement("placement")).toBe(false);
  });

  it("applique les seuils 60 / 80 du dossier fonctionnel", () => {
    expect(verdictPour(100)).toBe("acquis");
    expect(verdictPour(80)).toBe("acquis");
    expect(verdictPour(79)).toBe("a_consolider");
    expect(verdictPour(60)).toBe("a_consolider");
    expect(verdictPour(59)).toBe("prioritaire");
    expect(verdictPour(0)).toBe("prioritaire");
  });

  it("dresse un bilan par compétence, des plus faibles aux plus fortes", () => {
    const details = [
      { questionId: "q1", reponseDonnee: 1, correcte: true, bonneReponse: 1, explication: null },
      { questionId: "q2", reponseDonnee: 0, correcte: false, bonneReponse: 1, explication: null },
      { questionId: "q3", reponseDonnee: 2, correcte: true, bonneReponse: 2, explication: null },
      { questionId: "q4", reponseDonnee: null, correcte: false, bonneReponse: 0, explication: null },
    ];
    const bilan = bilanPositionnement(details, { q1: "A", q2: "A", q3: "B", q4: "B" });
    expect(bilan).toEqual([
      { competencyId: "A", nbQuestions: 2, nbCorrectes: 1, pourcent: 50, verdict: "prioritaire" },
      { competencyId: "B", nbQuestions: 2, nbCorrectes: 1, pourcent: 50, verdict: "prioritaire" },
    ]);
  });

  it("ignore les questions sans compétence et trie par score", () => {
    const details = [
      { questionId: "q1", reponseDonnee: 1, correcte: true, bonneReponse: 1, explication: null },
      { questionId: "q2", reponseDonnee: 1, correcte: true, bonneReponse: 1, explication: null },
      { questionId: "q3", reponseDonnee: 0, correcte: false, bonneReponse: 2, explication: null },
      { questionId: "q4", reponseDonnee: 0, correcte: true, bonneReponse: 0, explication: null },
    ];
    const bilan = bilanPositionnement(details, { q1: "A", q2: "A", q3: "B", q4: null });
    expect(bilan.map((b) => [b.competencyId, b.pourcent, b.verdict])).toEqual([
      ["B", 0, "prioritaire"],
      ["A", 100, "acquis"],
    ]);
  });

  it("ne propose le test qu'une fois", () => {
    const placement = [{ id: "p1" }];
    expect(positionnementAFaire(placement, [])).toEqual({ id: "p1" });
    expect(positionnementAFaire(placement, ["p1"])).toBeNull();
    expect(positionnementAFaire([], [])).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import {
  compteursSituations,
  libelleAuteur,
  normaliserTags,
  secteurParDefaut,
  secteursExperts,
  storytellerAtteint,
  trierSituations,
  validerSituation,
} from "@/lib/situations/situations";

const remplir = (n: number) => "x".repeat(n);
const VALIDE = {
  title: "Gestion d'un produit défectueux",
  context: remplir(120),
  situation: remplir(200),
  resolution: remplir(200),
  result: remplir(120),
};

describe("validerSituation", () => {
  it("accepte des champs dans les bornes et les nettoie", () => {
    const r = validerSituation({ ...VALIDE, title: "  Titre   propre  " }, 2);
    expect(r.ok).toBe(true);
    expect(r.champs.title).toBe("Titre propre");
  });

  it("signale chaque champ hors bornes avec sa longueur", () => {
    const r = validerSituation({ ...VALIDE, context: remplir(50), result: remplir(600) }, 1);
    expect(r.ok).toBe(false);
    expect(r.erreurs).toHaveLength(2);
    expect(r.erreurs[0]).toMatch(/Contexte : 100 caractères minimum \(50 saisis\)/);
    expect(r.erreurs[1]).toMatch(/Résultat : 500 caractères maximum/);
  });

  it("exige entre 1 et 5 compétences", () => {
    expect(validerSituation(VALIDE, 0).erreurs).toContain("Choisissez au moins une compétence mobilisée.");
    expect(validerSituation(VALIDE, 6).erreurs[0]).toMatch(/au plus 5/);
  });
});

describe("normaliserTags", () => {
  it("découpe, nettoie, dédoublonne et plafonne", () => {
    expect(normaliserTags(" Client VIP, réclamation ;#fidélisation, client vip, a ")).toEqual([
      "client vip",
      "réclamation",
      "fidélisation",
    ]);
    expect(normaliserTags(Array.from({ length: 12 }, (_, i) => `tag${i}`).join(","))).toHaveLength(8);
  });
});

describe("secteurParDefaut / libelleAuteur", () => {
  it("reconnaît un secteur connu, même accentué, sinon « autre »", () => {
    expect(secteurParDefaut("Hôtellerie", null)).toBe("hotellerie");
    expect(secteurParDefaut(null, "Banque de détail")).toBe("banque");
    expect(secteurParDefaut("Aéronautique", "Spatial")).toBe("autre");
  });

  it("anonymise derrière le secteur", () => {
    expect(libelleAuteur({ isAnonymized: false, fullName: "Awa Koné", secteur: "luxe" })).toBe("Awa Koné");
    expect(libelleAuteur({ isAnonymized: true, fullName: "Awa Koné", secteur: "luxe" })).toBe(
      "Un apprenant d'une entreprise du secteur luxe"
    );
    expect(libelleAuteur({ isAnonymized: false, fullName: "", secteur: "retail" })).toMatch(/secteur retail/);
  });
});

describe("trierSituations", () => {
  const liste = [
    { id: "a", useful_votes_count: 2, created_at: "2026-09-01" },
    { id: "b", useful_votes_count: 9, created_at: "2026-08-01" },
    { id: "c", useful_votes_count: 2, created_at: "2026-09-10" },
  ];
  it("trie par votes puis date, ou par date seule", () => {
    expect(trierSituations(liste, "utiles").map((s) => s.id)).toEqual(["b", "c", "a"]);
    expect(trierSituations(liste, "recentes").map((s) => s.id)).toEqual(["c", "a", "b"]);
  });
});

describe("compteurs et badges", () => {
  it("calcule les compteurs Storyteller, secteur et Problem Solver", () => {
    const c = compteursSituations([
      { votes: 6, sector: "luxe", isComplexProblem: true },
      { votes: 4, sector: "luxe", isComplexProblem: false },
      { votes: 8, sector: "retail", isComplexProblem: true },
    ]);
    expect(c.situations_validees).toBe(3);
    expect(c.moyenne_votes).toBe(6);
    expect(c.situations_storyteller).toBe(3);
    expect(c.situations_secteur).toEqual({ luxe: 2, retail: 1 });
    expect(c.problem_solver).toBe(2);
  });

  it("annule le compteur Storyteller sous la moyenne de 5 votes", () => {
    const c = compteursSituations([{ votes: 1, sector: "luxe", isComplexProblem: false }]);
    expect(c.situations_storyteller).toBe(0);
    expect(storytellerAtteint(10, 4.9)).toBe(false);
    expect(storytellerAtteint(10, 5)).toBe(true);
  });

  it("liste les secteurs à 5 situations ou plus", () => {
    expect(secteursExperts({ luxe: 5, retail: 4, banque: 7 })).toEqual(["banque", "luxe"]);
  });
});

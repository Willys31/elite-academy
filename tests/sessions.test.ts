import { describe, expect, it } from "vitest";
import {
  agregerResultats,
  codeValide,
  genererCodeSession,
  LONGUEUR_CODE,
  normaliserCode,
} from "@/lib/sessions/sessions";

describe("genererCodeSession", () => {
  it("produit un code de la bonne longueur et du bon alphabet", () => {
    const code = genererCodeSession(() => 0.5);
    expect(code).toHaveLength(LONGUEUR_CODE);
    expect(codeValide(code)).toBe(true);
  });

  it("évite les caractères ambigus (O, 0, I, 1, L)", () => {
    // Balaye toute la plage aléatoire.
    for (let i = 0; i < 100; i++) {
      const code = genererCodeSession(() => i / 100);
      expect(code).not.toMatch(/[O0I1L]/);
    }
  });

  it("reste dans l'alphabet même si la source retourne 1", () => {
    expect(codeValide(genererCodeSession(() => 0.999999))).toBe(true);
  });
});

describe("normaliserCode / codeValide", () => {
  it("normalise espaces, tirets et minuscules", () => {
    expect(normaliserCode(" ab-c 234 ")).toBe("ABC234");
  });

  it("valide les bons formats et rejette les mauvais", () => {
    expect(codeValide("ABC234")).toBe(true);
    expect(codeValide("abc234")).toBe(true);
    expect(codeValide("AB C2 34")).toBe(true);
    expect(codeValide("ABC23")).toBe(false); // trop court
    expect(codeValide("ABC2345")).toBe(false); // trop long
    expect(codeValide("ABC10O")).toBe(false); // caractères ambigus
    expect(codeValide("")).toBe(false);
  });
});

describe("agregerResultats", () => {
  it("agrège réponses, répondants uniques, moyenne et répartition", () => {
    const stats = agregerResultats([
      { userId: "u1", score: 100 },
      { userId: "u1", score: 40 }, // 2e tentative du même répondant
      { userId: "u2", score: 80 },
      { userId: "u3", score: null }, // ignorée
    ]);
    expect(stats.nbReponses).toBe(3);
    expect(stats.nbRepondants).toBe(2);
    expect(stats.moyenne).toBe(73);
    expect(stats.repartition).toEqual([
      { tranche: "0-49 %", nombre: 1 },
      { tranche: "50-74 %", nombre: 0 },
      { tranche: "75-89 %", nombre: 1 },
      { tranche: "90-100 %", nombre: 1 },
    ]);
  });

  it("gère l'absence de réponses", () => {
    const stats = agregerResultats([]);
    expect(stats.nbReponses).toBe(0);
    expect(stats.moyenne).toBeNull();
  });
});

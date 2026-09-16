import { describe, expect, it } from "vitest";
import {
  aChangeDeNiveau,
  libelleNiveau,
  niveauDepuisXp,
  NIVEAU_MAX,
  PALIERS,
} from "@/lib/gamification/niveaux";

describe("niveauDepuisXp", () => {
  it("commence au niveau 1, Débutant", () => {
    const n = niveauDepuisXp(0);
    expect(n.niveau).toBe(1);
    expect(n.titre).toBe("Débutant");
    expect(n.xpNiveauDebut).toBe(0);
    expect(n.progressionPourcent).toBe(0);
  });

  it("respecte les bornes de titre de l'addendum", () => {
    expect(niveauDepuisXp(500).titre).toBe("Débutant");
    expect(niveauDepuisXp(501).titre).toBe("Actif");
    expect(niveauDepuisXp(1500).titre).toBe("Actif");
    expect(niveauDepuisXp(1501).titre).toBe("Confirmé");
    expect(niveauDepuisXp(5001).titre).toBe("Expérimenté");
    expect(niveauDepuisXp(10001).titre).toBe("Expert");
    expect(niveauDepuisXp(20001).titre).toBe("Légende");
  });

  it("répartit les niveaux dans chaque palier", () => {
    expect(niveauDepuisXp(501).niveau).toBe(6);
    expect(niveauDepuisXp(1500).niveau).toBe(10);
    expect(niveauDepuisXp(1501).niveau).toBe(11);
    expect(niveauDepuisXp(20001).niveau).toBe(41);
  });

  it("est monotone et plafonne à 50", () => {
    let precedent = 0;
    for (let xp = 0; xp <= 60000; xp += 37) {
      const n = niveauDepuisXp(xp).niveau;
      expect(n).toBeGreaterThanOrEqual(precedent);
      precedent = n;
    }
    expect(niveauDepuisXp(1_000_000).niveau).toBe(NIVEAU_MAX);
    expect(niveauDepuisXp(1_000_000).xpNiveauSuivant).toBeNull();
    expect(niveauDepuisXp(-10).niveau).toBe(1);
  });

  it("calcule la progression dans le niveau", () => {
    const n = niveauDepuisXp(50); // niveau 1 : 0 → 100 XP environ
    expect(n.xpDansNiveau).toBe(50);
    expect(n.progressionPourcent).toBeGreaterThan(40);
    expect(n.progressionPourcent).toBeLessThan(60);
    expect(libelleNiveau(n)).toMatch(/^Niveau 1 · Débutant · 50\/\d+ XP$/);
  });

  it("couvre les XP sans trou entre paliers", () => {
    for (let i = 1; i < PALIERS.length; i++) {
      expect(PALIERS[i].xpMin).toBe((PALIERS[i - 1].xpMax ?? 0) + 1);
      expect(PALIERS[i].niveauMin).toBe(PALIERS[i - 1].niveauMax + 1);
    }
  });
});

describe("aChangeDeNiveau", () => {
  it("signale uniquement les montées", () => {
    expect(aChangeDeNiveau(0, 50)).toBeNull();
    expect(aChangeDeNiveau(490, 520)?.niveau).toBe(6);
    expect(aChangeDeNiveau(600, 500)).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import {
  calculerXpQcm,
  coefDifficulte,
  multiplicateurSerie,
  palierSerieAtteint,
  pointsDeBase,
  serieBonnesReponses,
  serieJours,
  seuilRapiditeSecondes,
  tauxBonusRapidite,
} from "@/lib/gamification/xp";

describe("points de base", () => {
  it("échelonne le coefficient de 10 à 30 selon la difficulté", () => {
    expect([1, 2, 3, 4, 5].map(coefDifficulte)).toEqual([10, 15, 20, 25, 30]);
    expect(coefDifficulte(0)).toBe(10);
    expect(coefDifficulte(9)).toBe(30);
  });

  it("proportionne au score", () => {
    expect(pointsDeBase(100, 3)).toBe(20);
    expect(pointsDeBase(50, 3)).toBe(10);
    expect(pointsDeBase(0, 5)).toBe(0);
    expect(pointsDeBase(140, 1)).toBe(10); // borné à 100 %
  });
});

describe("bonus de rapidité", () => {
  const seuil = seuilRapiditeSecondes(4); // 120 s

  it("est nul sous 80 % ou sans durée mesurée", () => {
    expect(tauxBonusRapidite(79, 10, seuil)).toBe(0);
    expect(tauxBonusRapidite(100, null, seuil)).toBe(0);
    expect(tauxBonusRapidite(100, 0, seuil)).toBe(0);
    expect(tauxBonusRapidite(100, -5, seuil)).toBe(0);
  });

  it("récompense la vitesse par paliers", () => {
    expect(tauxBonusRapidite(80, 60, seuil)).toBe(0.5);
    expect(tauxBonusRapidite(80, 90, seuil)).toBe(0.35);
    expect(tauxBonusRapidite(80, 120, seuil)).toBe(0.2);
    expect(tauxBonusRapidite(80, 121, seuil)).toBe(0);
  });
});

describe("série et total", () => {
  it("plafonne le multiplicateur à 1,5", () => {
    expect(multiplicateurSerie(0)).toBe(1);
    expect(multiplicateurSerie(3)).toBeCloseTo(1.3);
    expect(multiplicateurSerie(10)).toBe(1.5);
  });

  it("applique la formule complète", () => {
    const r = calculerXpQcm({
      scorePourcent: 100,
      difficulte: 3,
      nbQuestions: 4,
      dureeSecondes: 50,
      serieAvant: 2,
    });
    expect(r.base).toBe(20);
    expect(r.bonus).toBe(10);
    expect(r.multiplicateur).toBeCloseTo(1.2);
    expect(r.total).toBe(36);
    expect(r.rapiditeActivee).toBe(true);
  });

  it("n'accorde ni bonus ni série sur un échec", () => {
    const r = calculerXpQcm({
      scorePourcent: 40,
      difficulte: 2,
      nbQuestions: 5,
      dureeSecondes: 10,
      serieAvant: 0,
    });
    expect(r).toEqual({ base: 6, bonus: 0, multiplicateur: 1, total: 6, rapiditeActivee: false });
  });

  it("compte les bonnes tentatives consécutives les plus récentes", () => {
    expect(serieBonnesReponses([{ score: 90 }, { score: 30 }, { score: 85 }, { score: 100 }])).toBe(2);
    expect(serieBonnesReponses([{ score: 50 }])).toBe(0);
    expect(serieBonnesReponses([{ score: null }, { score: 80 }])).toBe(1);
    expect(serieBonnesReponses([])).toBe(0);
  });
});

describe("série de jours", () => {
  it("compte les jours consécutifs jusqu'à aujourd'hui", () => {
    expect(serieJours(["2026-09-14", "2026-09-15", "2026-09-16"], "2026-09-16")).toBe(3);
  });

  it("ne rompt pas la série si aujourd'hui n'est pas encore joué", () => {
    expect(serieJours(["2026-09-14", "2026-09-15"], "2026-09-16")).toBe(2);
    expect(serieJours(["2026-09-13", "2026-09-14"], "2026-09-16")).toBe(0);
  });

  it("ignore les trous et les doublons", () => {
    expect(serieJours(["2026-09-16", "2026-09-16", "2026-09-14"], "2026-09-16")).toBe(1);
  });

  it("détecte le palier franchi", () => {
    expect(palierSerieAtteint(6, 7)).toBe(7);
    expect(palierSerieAtteint(7, 8)).toBeNull();
    expect(palierSerieAtteint(29, 31)).toBe(30);
  });
});

import { describe, expect, it } from "vitest";
import {
  badgeParCle,
  CATALOGUE_BADGES,
  cleObtention,
  compteursMaitrise,
  distinctions,
  evaluerBadges,
  FAMILLES,
  prochainBadge,
} from "@/lib/gamification/badges";

describe("catalogue", () => {
  it("a des clés uniques et des familles connues", () => {
    const cles = CATALOGUE_BADGES.map((b) => b.key);
    expect(new Set(cles).size).toBe(cles.length);
    for (const b of CATALOGUE_BADGES) expect(FAMILLES).toContain(b.famille);
  });

  it("définit une cible pour chaque badge à compteur, et un contexte pour les événementiels non spéciaux", () => {
    for (const b of CATALOGUE_BADGES) {
      if (b.compteur !== null) expect(b.cible).toBeGreaterThan(0);
      else if (!b.special) expect(b.contexte).not.toBeNull();
    }
  });

  it("classe les distinctions à part", () => {
    const d = distinctions();
    expect(d.length).toBe(5);
    expect(d.every((b) => b.special && b.famille === "distinction")).toBe(true);
    expect(badgeParCle("elite_performer")?.special).toBe(true);
  });

  it("garde des paliers croissants dans une même série", () => {
    const reflexe = CATALOGUE_BADGES.filter((b) => b.compteur === "reflexe").map((b) => b.cible);
    expect(reflexe).toEqual([1, 5, 20, 50]);
  });
});

describe("evaluerBadges", () => {
  it("débloque tous les paliers atteints et ignore les obtenus", () => {
    const nouveaux = evaluerBadges({ reflexe: 6, sans_faute: 1 }, new Set([cleObtention("reflexe_bronze")]));
    expect(nouveaux.map((n) => n.key).sort()).toEqual(["reflexe_argent", "sans_faute_bronze"]);
  });

  it("ne débloque jamais une distinction ni un badge événementiel", () => {
    const nouveaux = evaluerBadges({ serie_jours: 400 }, new Set());
    expect(nouveaux.map((n) => n.key)).toEqual(["serie_7", "serie_30", "serie_100", "serie_365"]);
    expect(nouveaux.some((n) => n.key === "commitment_award")).toBe(false);
  });
});

describe("prochainBadge", () => {
  it("propose le palier manquant le plus proche", () => {
    const p = prochainBadge({ reflexe: 4, sans_faute: 1 }, new Set([cleObtention("sans_faute_bronze")]));
    expect(p?.badge.key).toBe("reflexe_bronze"); // 4/1 non obtenu : ratio > 1 mais non débloqué encore
    const p2 = prochainBadge(
      { reflexe: 4, sans_faute: 1 },
      new Set([cleObtention("sans_faute_bronze"), cleObtention("reflexe_bronze")])
    );
    expect(p2?.badge.key).toBe("reflexe_argent");
    expect(p2?.actuel).toBe(4);
    expect(p2?.cible).toBe(5);
  });

  it("renvoie null si tout est obtenu", () => {
    const tous = new Set(CATALOGUE_BADGES.map((b) => cleObtention(b.key)));
    expect(prochainBadge({}, tous)).toBeNull();
  });
});

describe("compteursMaitrise", () => {
  it("compte les niveaux atteints et les domaines distincts", () => {
    const c = compteursMaitrise([
      { mastery_level: "operational", domain: "Vente" },
      { mastery_level: "advanced", domain: "vente " },
      { mastery_level: "elite", domain: null },
      { mastery_level: "fundamentals", domain: "RH" },
      { mastery_level: null, domain: "RH" },
    ]);
    expect(c).toEqual({
      operationnel_competences: 3,
      avance_competences: 2,
      elite_competences: 1,
      domaines_operationnels: 2,
    });
  });
});

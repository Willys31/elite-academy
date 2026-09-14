import { describe, expect, it } from "vitest";
import {
  meilleursScores,
  moyenneGroupe,
  resumerApprenants,
  syntheseParActivite,
  syntheseParApprenant,
  type LigneTentative,
} from "@/lib/resultats/resultats";

function t(
  userId: string,
  activityId: string,
  score: number | null,
  nom = userId,
  titre = activityId
): LigneTentative {
  return { userId, nom, activityId, titreActivite: titre, score };
}

describe("meilleursScores", () => {
  it("retient le meilleur essai de chaque couple apprenant / activité", () => {
    const m = meilleursScores([
      t("u1", "a1", 40),
      t("u1", "a1", 80),
      t("u1", "a1", 60),
    ]);
    expect([...m.values()]).toEqual([80]);
  });

  it("sépare deux apprenants sur la même activité", () => {
    const m = meilleursScores([t("u1", "a1", 80), t("u2", "a1", 50)]);
    expect(m.size).toBe(2);
  });

  it("ignore les scores absents plutôt que de les compter comme zéro", () => {
    const m = meilleursScores([t("u1", "a1", null), t("u2", "a1", 100)]);
    expect([...m.values()]).toEqual([100]);
  });
});

describe("syntheseParActivite", () => {
  it("calcule la moyenne sur les meilleurs essais", () => {
    const s = syntheseParActivite([
      t("u1", "a1", 20),
      t("u1", "a1", 100), // le même apprenant a progressé
      t("u2", "a1", 80),
    ]);
    expect(s[0].nbApprenants).toBe(2);
    expect(s[0].moyenne).toBe(90);
  });

  it("classe les activités de la plus faible à la plus forte moyenne", () => {
    const s = syntheseParActivite([
      t("u1", "facile", 95),
      t("u1", "difficile", 30),
      t("u2", "moyenne", 70),
    ]);
    expect(s.map((x) => x.activityId)).toEqual(["difficile", "moyenne", "facile"]);
  });

  it("compte les apprenants en difficulté sous 50 %", () => {
    const s = syntheseParActivite([
      t("u1", "a1", 20),
      t("u2", "a1", 49),
      t("u3", "a1", 50),
    ]);
    expect(s[0].nbEnDifficulte).toBe(2);
  });

  it("répartit les scores dans les quatre tranches", () => {
    const s = syntheseParActivite([
      t("u1", "a1", 10),
      t("u2", "a1", 60),
      t("u3", "a1", 80),
      t("u4", "a1", 100),
    ]);
    expect(s[0].repartition.map((r) => r.nombre)).toEqual([1, 1, 1, 1]);
  });

  it("garde le titre lisible de l'activité", () => {
    const s = syntheseParActivite([t("u1", "a1", 50, "Awa", "QCM sur les conflits")]);
    expect(s[0].titre).toBe("QCM sur les conflits");
  });
});

describe("syntheseParApprenant", () => {
  it("classe les apprenants du plus faible au plus fort", () => {
    const s = syntheseParApprenant([
      t("u1", "a1", 90, "Awa"),
      t("u2", "a1", 40, "Koffi"),
    ]);
    expect(s.map((x) => x.nom)).toEqual(["Koffi", "Awa"]);
  });

  it("moyenne un apprenant sur ses activités distinctes", () => {
    const s = syntheseParApprenant([
      t("u1", "a1", 100),
      t("u1", "a1", 50), // essai plus faible, ignoré
      t("u1", "a2", 60),
    ]);
    expect(s[0].nbActivites).toBe(2);
    expect(s[0].moyenne).toBe(80);
  });

  it("expose le meilleur score par activité pour le tableau croisé", () => {
    const s = syntheseParApprenant([t("u1", "a1", 70), t("u1", "a2", 30)]);
    expect(s[0].parActivite).toEqual({ a1: 70, a2: 30 });
  });
});

describe("moyenneGroupe", () => {
  it("agrège tous les meilleurs scores", () => {
    expect(moyenneGroupe([t("u1", "a1", 100), t("u2", "a1", 50)])).toBe(75);
  });

  it("vaut null quand aucun score n'est exploitable", () => {
    expect(moyenneGroupe([t("u1", "a1", null)])).toBeNull();
    expect(moyenneGroupe([])).toBeNull();
  });
});

describe("resumerApprenants", () => {
  it("ne compte qu'une fois un apprenant vu dans plusieurs sessions", () => {
    const r = resumerApprenants([
      { sessionId: "s1", userId: "u1", nom: "Awa", joinedAt: "2026-09-01T10:00:00Z" },
      { sessionId: "s2", userId: "u1", nom: "Awa", joinedAt: "2026-09-05T10:00:00Z" },
    ]);
    expect(r).toHaveLength(1);
    expect(r[0].nbSessions).toBe(2);
    expect(r[0].dernierePresence).toBe("2026-09-05T10:00:00Z");
  });

  it("ne double pas le compte si la même session revient deux fois", () => {
    const r = resumerApprenants([
      { sessionId: "s1", userId: "u1", nom: "Awa", joinedAt: null },
      { sessionId: "s1", userId: "u1", nom: "Awa", joinedAt: null },
    ]);
    expect(r[0].nbSessions).toBe(1);
  });

  it("classe par nombre de présences puis par nom", () => {
    const r = resumerApprenants([
      { sessionId: "s1", userId: "u1", nom: "Zoé", joinedAt: null },
      { sessionId: "s1", userId: "u2", nom: "Awa", joinedAt: null },
      { sessionId: "s2", userId: "u3", nom: "Koffi", joinedAt: null },
      { sessionId: "s3", userId: "u3", nom: "Koffi", joinedAt: null },
    ]);
    expect(r.map((x) => x.nom)).toEqual(["Koffi", "Awa", "Zoé"]);
  });

  it("garde une date connue face à une date absente", () => {
    const r = resumerApprenants([
      { sessionId: "s1", userId: "u1", nom: "Awa", joinedAt: "2026-09-01T10:00:00Z" },
      { sessionId: "s2", userId: "u1", nom: "Awa", joinedAt: null },
    ]);
    expect(r[0].dernierePresence).toBe("2026-09-01T10:00:00Z");
  });
});

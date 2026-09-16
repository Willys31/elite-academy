import { describe, expect, it } from "vitest";
import {
  classerParticipants,
  fenetreClassement,
  medaille,
  type LigneClassement,
} from "@/lib/gamification/classement";

describe("fenetreClassement", () => {
  it("cadre la semaine du lundi au dimanche (UTC)", () => {
    const f = fenetreClassement("semaine", new Date("2026-09-16T10:00:00Z")); // mercredi
    expect(f.debut).toBe("2026-09-14T00:00:00.000Z");
    expect(f.fin).toBe("2026-09-21T00:00:00.000Z");
    expect(f.libelle).toBe("Semaine du 14 au 20 septembre");
  });

  it("gère une semaine à cheval sur deux mois", () => {
    const f = fenetreClassement("semaine", new Date("2026-10-01T10:00:00Z")); // jeudi
    expect(f.libelle).toBe("Semaine du 28 septembre au 4 octobre");
  });

  it("cadre le mois civil", () => {
    const f = fenetreClassement("mois", new Date("2026-09-16T10:00:00Z"));
    expect(f.debut).toBe("2026-09-01T00:00:00.000Z");
    expect(f.fin).toBe("2026-10-01T00:00:00.000Z");
    expect(f.libelle).toBe("Septembre 2026");
  });
});

const ligne = (id: string, xp: number, badges = 0, score: number | null = null, inscrit = "2026-01-01"): LigneClassement => ({
  user_id: id,
  nom_affiche: id,
  xp_total: xp,
  nb_badges: badges,
  score_moyen: score,
  inscrit_le: inscrit,
});

describe("classerParticipants", () => {
  it("trie par XP puis badges, score, ancienneté", () => {
    const c = classerParticipants(
      [
        ligne("a", 100, 0, 50, "2026-02-01"),
        ligne("b", 100, 1, 50),
        ligne("c", 100, 0, 50, "2026-01-01"),
        ligne("d", 300),
      ],
      "a"
    );
    expect(c.classes.map((l) => l.user_id)).toEqual(["d", "b", "c", "a"]);
    expect(c.classes.map((l) => l.rang)).toEqual([1, 2, 3, 3]); // c et a ex aequo
    expect(c.maPosition?.rang).toBe(3);
    expect(c.maPosition?.moi).toBe(true);
  });

  it("construit le top 10 et la fenêtre autour de moi", () => {
    const lignes = Array.from({ length: 15 }, (_, i) => ligne(`u${i}`, 1000 - i * 10));
    const c = classerParticipants(lignes, "u12");
    expect(c.top).toHaveLength(10);
    expect(c.autourDeMoi.map((l) => l.user_id)).toEqual(["u10", "u11", "u12", "u13", "u14"]);
    expect(c.nbParticipants).toBe(15);
  });

  it("gère l'absence de l'utilisateur (masqué ou non inscrit)", () => {
    const c = classerParticipants([ligne("a", 10)], "z");
    expect(c.maPosition).toBeNull();
    expect(c.autourDeMoi).toEqual([]);
  });
});

describe("medaille", () => {
  it("dore le podium seulement", () => {
    expect([1, 2, 3, 4].map(medaille)).toEqual(["or", "argent", "bronze", null]);
  });
});

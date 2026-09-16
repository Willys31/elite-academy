import { describe, expect, it } from "vitest";
import {
  compterNonLues,
  dateRelative,
  libelleType,
  regrouperParJour,
  tronquer,
} from "@/lib/notifications/notifications";

const MAINTENANT = new Date(2026, 8, 16, 14, 30, 0); // 16 sept. 2026, 14:30 locale

describe("compterNonLues", () => {
  it("ne compte que les lignes sans date de lecture", () => {
    expect(
      compterNonLues([{ read_at: null }, { read_at: "2026-09-01" }, { read_at: null }])
    ).toBe(2);
    expect(compterNonLues([])).toBe(0);
  });
});

describe("libelleType", () => {
  it("connaît les types des lots et retombe sur Information", () => {
    expect(libelleType("badge_debloque")).toBe("Badge");
    expect(libelleType("alerte_blocage")).toBe("Tutorat IA");
    expect(libelleType("type_inconnu")).toBe("Information");
  });
});

describe("tronquer", () => {
  it("laisse intact un texte court et coupe sur un espace sinon", () => {
    expect(tronquer("Bonjour", 20)).toBe("Bonjour");
    const long = tronquer("Une contribution qui dépasse la limite fixée", 20);
    expect(long.endsWith("…")).toBe(true);
    expect(long.length).toBeLessThanOrEqual(20);
    expect(long).not.toMatch(/\s…$/);
  });
});

describe("dateRelative", () => {
  const il_y_a = (ms: number) => new Date(MAINTENANT.getTime() - ms).toISOString();

  it("décrit les écarts courts en minutes et heures", () => {
    expect(dateRelative(il_y_a(10_000), MAINTENANT)).toBe("à l'instant");
    expect(dateRelative(il_y_a(5 * 60_000), MAINTENANT)).toBe("il y a 5 min");
    expect(dateRelative(il_y_a(3 * 3_600_000), MAINTENANT)).toBe("il y a 3 h");
  });

  it("dit « hier » pour la veille, même à moins de 24 h", () => {
    // 20 h la veille : moins de 24 h, mais un autre jour.
    expect(dateRelative(il_y_a(18.5 * 3_600_000), MAINTENANT)).toBe("hier");
  });

  it("compte les jours puis affiche la date", () => {
    expect(dateRelative(il_y_a(4 * 86_400_000), MAINTENANT)).toBe("il y a 4 jours");
    expect(dateRelative(il_y_a(30 * 86_400_000), MAINTENANT)).toMatch(/août/);
  });

  it("traite une date future comme immédiate", () => {
    expect(dateRelative(new Date(MAINTENANT.getTime() + 60_000).toISOString(), MAINTENANT)).toBe(
      "à l'instant"
    );
  });
});

describe("regrouperParJour", () => {
  it("regroupe en conservant l'ordre et nomme Aujourd'hui / Hier", () => {
    const liste = [
      { id: "a", created_at: new Date(2026, 8, 16, 12).toISOString() },
      { id: "b", created_at: new Date(2026, 8, 16, 9).toISOString() },
      { id: "c", created_at: new Date(2026, 8, 15, 22).toISOString() },
      { id: "d", created_at: new Date(2026, 8, 10, 8).toISOString() },
    ];
    const groupes = regrouperParJour(liste, MAINTENANT);
    expect(groupes.map((g) => g.libelle)).toEqual([
      "Aujourd'hui",
      "Hier",
      expect.stringMatching(/10 septembre/),
    ]);
    expect(groupes[0].notifications.map((n) => n.id)).toEqual(["a", "b"]);
    expect(groupes[2].notifications[0].id).toBe("d");
  });

  it("renvoie une liste vide sans notification", () => {
    expect(regrouperParJour([], MAINTENANT)).toEqual([]);
  });
});

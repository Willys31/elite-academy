import { describe, expect, it } from "vitest";
import {
  dureeMinutes,
  formaterDuree,
  fusionnerPassages,
  lireLienMeet,
  lireMode,
  modeAvecVisio,
  rapprocherPresencesMeet,
  type InscritSession,
} from "@/lib/sessions/visio";

describe("lireMode / modeAvecVisio", () => {
  it("retombe sur le présentiel pour une valeur inconnue", () => {
    expect(lireMode("remote")).toBe("remote");
    expect(lireMode("hybrid")).toBe("hybrid");
    expect(lireMode("zoom")).toBe("onsite");
    expect(lireMode(null)).toBe("onsite");
  });

  it("n'associe la visio qu'aux modes visio et hybride", () => {
    expect(modeAvecVisio("onsite")).toBe(false);
    expect(modeAvecVisio("remote")).toBe(true);
    expect(modeAvecVisio("hybrid")).toBe(true);
    expect(modeAvecVisio(undefined)).toBe(false);
  });
});

describe("lireLienMeet", () => {
  it("accepte un lien complet, sans protocole, avec paramètres, ou un code seul", () => {
    const attendu = { uri: "https://meet.google.com/abc-defg-hij", code: "abc-defg-hij" };
    expect(lireLienMeet("https://meet.google.com/abc-defg-hij")).toEqual(attendu);
    expect(lireLienMeet("meet.google.com/abc-defg-hij?authuser=0")).toEqual(attendu);
    expect(lireLienMeet("  HTTPS://MEET.GOOGLE.COM/ABC-DEFG-HIJ/ ")).toEqual(attendu);
    expect(lireLienMeet("abc-defg-hij")).toEqual(attendu);
  });

  it("refuse les autres domaines et les codes mal formés", () => {
    expect(lireLienMeet("https://zoom.us/j/123456")).toBeNull();
    expect(lireLienMeet("https://meet.google.com.evil.com/abc-defg-hij")).toBeNull();
    expect(lireLienMeet("https://meet.google.com/abc-def-hij")).toBeNull();
    expect(lireLienMeet("https://meet.google.com/lookup/xyz")).toBeNull();
    expect(lireLienMeet("")).toBeNull();
  });
});

describe("fusionnerPassages", () => {
  it("garde la première arrivée et le dernier départ d'une même personne", () => {
    const r = fusionnerPassages([
      { nom: "Awa Koné", debut: "2026-09-24T09:05:00Z", fin: "2026-09-24T09:30:00Z" },
      { nom: "Awa Koné", debut: "2026-09-24T09:35:00Z", fin: "2026-09-24T10:55:00Z" },
    ]);
    expect(r).toEqual([{ nom: "Awa Koné", debut: "2026-09-24T09:05:00Z", fin: "2026-09-24T10:55:00Z" }]);
  });

  it("considère la personne encore connectée si un passage est ouvert", () => {
    const r = fusionnerPassages([
      { nom: "Awa Koné", debut: "2026-09-24T09:05:00Z", fin: null },
      { nom: "Awa Koné", debut: "2026-09-24T08:58:00Z", fin: "2026-09-24T09:02:00Z" },
    ]);
    expect(r[0]).toMatchObject({ debut: "2026-09-24T08:58:00Z", fin: null });
  });
});

describe("rapprocherPresencesMeet", () => {
  const inscrits: InscritSession[] = [
    { participantId: "p1", userId: "u1", fullName: "Awa Koné", canal: "remote" },
    { participantId: "p2", userId: "u2", fullName: "Koffi Yao", canal: "remote" },
    { participantId: "p3", userId: "u3", fullName: "Marie Bamba", canal: "onsite" },
  ];
  const formateur = { userId: "f1", fullName: "Cédric N'Guessan" };
  const cloture = "2026-09-24T11:00:00Z";

  it("reporte arrivée et départ des inscrits à distance reconnus", () => {
    const r = rapprocherPresencesMeet(
      [
        { nom: "awa kone", debut: "2026-09-24T09:03:00Z", fin: "2026-09-24T10:20:00Z" },
        { nom: "Koffi", debut: "2026-09-24T09:00:00Z", fin: null },
      ],
      inscrits,
      formateur,
      cloture
    );
    expect(r.presences).toEqual([
      { participantId: "p1", arrivee: "2026-09-24T09:03:00Z", depart: "2026-09-24T10:20:00Z" },
      { participantId: "p2", arrivee: "2026-09-24T09:00:00Z", depart: null },
    ]);
    expect(r.nonReconnus).toEqual([]);
  });

  it("traite un départ à la clôture ou après comme resté jusqu'au bout", () => {
    const r = rapprocherPresencesMeet(
      [{ nom: "Awa Koné", debut: "2026-09-24T09:00:00Z", fin: "2026-09-24T11:04:00Z" }],
      inscrits,
      formateur,
      cloture
    );
    expect(r.presences[0].depart).toBeNull();
  });

  it("ne touche ni au formateur ni aux inscrits sur place, et liste les inconnus", () => {
    const r = rapprocherPresencesMeet(
      [
        { nom: "Cédric N'Guessan", debut: "2026-09-24T08:55:00Z", fin: "2026-09-24T11:01:00Z" },
        { nom: "Marie Bamba", debut: "2026-09-24T09:00:00Z", fin: "2026-09-24T09:10:00Z" },
        { nom: "iPhone de Jean", debut: "2026-09-24T09:15:00Z", fin: "2026-09-24T09:40:00Z" },
      ],
      inscrits,
      formateur,
      cloture
    );
    expect(r.presences).toEqual([]);
    expect(r.nonReconnus).toEqual(["iPhone de Jean"]);
    expect(r.debutVisio).toBe("2026-09-24T08:55:00.000Z");
    expect(r.finVisio).toBe("2026-09-24T11:01:00.000Z");
  });

  it("laisse la fin de visio vide tant que quelqu'un est connecté", () => {
    const r = rapprocherPresencesMeet(
      [{ nom: "Koffi Yao", debut: "2026-09-24T09:00:00Z", fin: null }],
      inscrits,
      formateur,
      cloture
    );
    expect(r.finVisio).toBeNull();
  });
});

describe("durées", () => {
  it("calcule et formate une durée", () => {
    expect(dureeMinutes("2026-09-24T09:00:00Z", "2026-09-24T11:05:00Z")).toBe(125);
    expect(dureeMinutes(null, "2026-09-24T11:05:00Z")).toBeNull();
    expect(formaterDuree(125)).toBe("2 h 05");
    expect(formaterDuree(45)).toBe("45 min");
    expect(formaterDuree(null)).toBe("—");
  });
});

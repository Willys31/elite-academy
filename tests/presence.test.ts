import { describe, expect, it } from "vitest";
import {
  calculerPresence,
  lireNote,
  moyennesFeedback,
  presenceAvecJustification,
  tauxParticipation,
} from "@/lib/sessions/presence";

const T0 = new Date("2026-09-16T09:00:00Z");
const iso = (minutes: number) => new Date(T0.getTime() + minutes * 60_000).toISOString();

const session = { debutPrevu: iso(0), finPrevue: iso(120), cloturee: iso(120) };

describe("calculerPresence", () => {
  it("présent et ponctuel, resté jusqu'au bout : 30 XP", () => {
    const r = calculerPresence({ ...session, arrivee: iso(0), depart: null });
    expect(r.statut).toBe("present");
    expect(r.ponctualite).toBe("on_time");
    expect(r.taux).toBe(1);
    expect(r.xp).toEqual({ presence: 20, ponctualite: 10, penalite: 0, total: 30 });
  });

  it("léger retard (≤ 5 min) reste ponctuel", () => {
    const r = calculerPresence({ ...session, arrivee: iso(5), depart: null });
    expect(r.ponctualite).toBe("late_ok");
    expect(r.statut).toBe("present");
    expect(r.xp.total).toBe(30);
  });

  it("retard > 5 min : statut En retard, 0 XP de présence", () => {
    const r = calculerPresence({ ...session, arrivee: iso(6), depart: null });
    expect(r.ponctualite).toBe("late");
    expect(r.statut).toBe("late");
    expect(r.xp).toEqual({ presence: 0, ponctualite: 0, penalite: 0, total: 0 });
  });

  it("partiel : moins de 80 % du temps", () => {
    const r = calculerPresence({ ...session, arrivee: iso(0), depart: iso(60) });
    expect(r.taux).toBe(0.5);
    expect(r.statut).toBe("left_early"); // parti à mi-session, > 10 min avant la fin
    expect(r.departAnticipe).toBe(true);
    expect(r.xp).toEqual({ presence: 10, ponctualite: 0, penalite: -10, total: 0 });
  });

  it("parti 5 min avant la fin : présent, pas de pénalité", () => {
    const r = calculerPresence({ ...session, arrivee: iso(0), depart: iso(115) });
    expect(r.statut).toBe("present");
    expect(r.departAnticipe).toBe(false);
    expect(r.xp.total).toBe(30);
  });

  it("parti 15 min avant la fin en ayant fait ≥ 80 % : présent mais pénalisé", () => {
    const r = calculerPresence({ ...session, arrivee: iso(0), depart: iso(105) });
    expect(r.taux).toBeCloseTo(0.875);
    expect(r.statut).toBe("present");
    expect(r.xp).toEqual({ presence: 20, ponctualite: 10, penalite: -10, total: 20 });
  });

  it("absent : jamais arrivé", () => {
    const r = calculerPresence({ ...session, arrivee: null, depart: null });
    expect(r.statut).toBe("absent");
    expect(r.xp.total).toBe(0);
  });

  it("sans heure prévue, la première arrivée fait référence", () => {
    const r = calculerPresence({
      debutPrevu: null,
      finPrevue: null,
      cloturee: iso(90),
      arrivee: iso(10),
      depart: null,
      premiereArrivee: iso(0),
    });
    expect(r.retardSecondes).toBe(600);
    expect(r.ponctualite).toBe("late");
  });

  it("la clôture avant la fin prévue raccourcit la référence", () => {
    const r = calculerPresence({ debutPrevu: iso(0), finPrevue: iso(180), cloturee: iso(60), arrivee: iso(0), depart: null });
    expect(r.taux).toBe(1);
    expect(r.statut).toBe("present");
  });

  it("une justification acceptée recalcule sans le départ", () => {
    const r = presenceAvecJustification({ ...session, arrivee: iso(0), depart: iso(60) });
    expect(r.statut).toBe("present");
    expect(r.xp.total).toBe(30);
  });
});

describe("feedback et participation", () => {
  it("fait des moyennes en ignorant les notes manquantes", () => {
    const m = moyennesFeedback([
      { satisfaction_score: 5, clarity_score: 4, usefulness_score: null },
      { satisfaction_score: 4, clarity_score: null, usefulness_score: 3 },
    ]);
    expect(m).toEqual({ satisfaction: 4.5, clarte: 4, utilite: 3, n: 2 });
    expect(moyennesFeedback([]).satisfaction).toBeNull();
  });

  it("calcule le taux de participation borné", () => {
    expect(tauxParticipation(7, 10)).toBe(70);
    expect(tauxParticipation(12, 10)).toBe(100);
    expect(tauxParticipation(3, 0)).toBe(0);
  });

  it("lit une note 1–5", () => {
    expect(lireNote("4")).toBe(4);
    expect(lireNote("6")).toBeNull();
    expect(lireNote("")).toBeNull();
  });
});

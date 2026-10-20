import { describe, expect, it } from "vitest";
import {
  correctionHumaineForcee,
  decisionAutomatique,
  estCorrigeeAutomatiquement,
  estRevisable,
  libelleDecision,
  lireDecision,
  lireReglagesCorrectionAuto,
  relectureDemandee,
  SEUIL_CONFIANCE_DEFAUT,
} from "@/lib/courses/correction-auto";
import type { PropositionCorrection } from "@/lib/ai/precorrection";

/* ------------------------------------------------------------------
   Lot 27 – correction automatique : réglages, décision, état d'une copie
   ------------------------------------------------------------------ */

function proposition(extra: Partial<PropositionCorrection> = {}): PropositionCorrection {
  return {
    verdict: "acquise",
    confiance: 0.9,
    criteres: [],
    type_difficulte: null,
    points_forts: [],
    a_travailler: [],
    feedback_apprenant: "Bien.",
    commentaire_formateur: "",
    warnings: [],
    ...extra,
  };
}

describe("réglages", () => {
  it("est actif par défaut avec un seuil de 0,7", () => {
    expect(lireReglagesCorrectionAuto(() => "")).toEqual({ actif: true, seuil: SEUIL_CONFIANCE_DEFAUT });
    expect(SEUIL_CONFIANCE_DEFAUT).toBe(0.7);
  });

  it("se désactive avec CORRECTION_AUTO=off et lit un seuil valide, avec repli", () => {
    const env = (v: Record<string, string>) => (n: string) => v[n] ?? "";
    expect(lireReglagesCorrectionAuto(env({ CORRECTION_AUTO: "off" })).actif).toBe(false);
    expect(lireReglagesCorrectionAuto(env({ CORRECTION_AUTO: "non" })).actif).toBe(false);
    expect(lireReglagesCorrectionAuto(env({ CORRECTION_SEUIL: "0,85" })).seuil).toBe(0.85);
    expect(lireReglagesCorrectionAuto(env({ CORRECTION_SEUIL: "7" })).seuil).toBe(0.7);
    expect(lireReglagesCorrectionAuto(env({ CORRECTION_SEUIL: "abc" })).seuil).toBe(0.7);
  });

  it("lit le forçage humain d'une activité", () => {
    expect(correctionHumaineForcee({ correction_humaine: true })).toBe(true);
    expect(correctionHumaineForcee({ correction_humaine: "oui" })).toBe(false);
    expect(correctionHumaineForcee(null)).toBe(false);
    expect(correctionHumaineForcee({})).toBe(false);
  });
});

describe("decisionAutomatique", () => {
  it("pose les notes quand chaque proposition est nette et assez sûre", () => {
    const notes = decisionAutomatique({ q1: proposition(), q2: proposition({ verdict: "non_acquise", confiance: 0.7, feedback_apprenant: "Il manque…" }) }, ["q1", "q2"], 0.7);
    expect(notes).toEqual({ q1: { acquise: true, commentaire: "Bien." }, q2: { acquise: false, commentaire: "Il manque…" } });
  });

  it("laisse la main au formateur en cas de doute", () => {
    expect(decisionAutomatique({ q1: proposition({ verdict: "incertain" }) }, ["q1"], 0.7)).toBeNull();
    expect(decisionAutomatique({ q1: proposition({ confiance: 0.69 }) }, ["q1"], 0.7)).toBeNull();
    expect(decisionAutomatique({ q1: proposition({ feedback_apprenant: "" }) }, ["q1"], 0.7)).toBeNull();
    expect(decisionAutomatique({ q1: proposition() }, ["q1", "q2"], 0.7)).toBeNull();
    expect(decisionAutomatique({}, [], 0.7)).toBeNull();
  });

  it("une seule question douteuse bloque toute la copie", () => {
    expect(decisionAutomatique({ q1: proposition(), q2: proposition({ confiance: 0.5 }) }, ["q1", "q2"], 0.7)).toBeNull();
  });
});

describe("état d'une copie", () => {
  const auto = { decision: { mode: "automatique", le: "2026-10-20T10:00:00Z" } };
  it("lit la décision et la relecture", () => {
    expect(lireDecision(auto)?.mode).toBe("automatique");
    expect(lireDecision({ decision: { mode: "autre" } })).toBeNull();
    expect(lireDecision(null)).toBeNull();
    expect(estCorrigeeAutomatiquement(auto)).toBe(true);
    expect(estCorrigeeAutomatiquement({ decision: { mode: "humaine", le: "x" } })).toBe(false);
    expect(relectureDemandee(auto)).toBe(false);
    expect(relectureDemandee({ decision: { ...auto.decision, relecture: { demandee_le: "x" } } })).toBe(true);
    expect(relectureDemandee({ decision: { ...auto.decision, relecture: { demandee_le: "x", traitee_le: "y" } } })).toBe(false);
  });

  it("n'est révisable qu'avec une réponse rédigée", () => {
    expect(estRevisable({ details: [{ type: "qcm" } as never] })).toBe(false);
    expect(estRevisable({ details: [{ type: "open" } as never] })).toBe(true);
    expect(estRevisable(null)).toBe(false);
  });

  it("libelle la décision sans nommer le moteur", () => {
    expect(libelleDecision(null)).toBe("Corrigée");
    expect(libelleDecision({ mode: "automatique", le: "x" })).toBe("Corrigée automatiquement");
    expect(libelleDecision({ mode: "humaine", le: "x" })).toBe("Corrigée par un formateur");
    expect(libelleDecision({ mode: "automatique", le: "x", revisee_le: "y" })).toBe("Corrigée, puis révisée par un formateur");
    for (const l of [libelleDecision(null), libelleDecision({ mode: "automatique", le: "x" })]) expect(l).not.toMatch(/IA|DeepSeek|modèle/i);
  });
});

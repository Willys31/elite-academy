import { describe, expect, it } from "vitest";
import {
  COMMENTAIRE_SANS_FEEDBACK,
  decisionAutomatique,
  estCorrigeeAutomatiquement,
  estRevisable,
  libelleDecision,
  lireDecision,
  lireReglagesCorrectionAuto,
} from "@/lib/courses/correction-auto";
import { propositionReponseInsuffisante, type PropositionCorrection } from "@/lib/ai/precorrection";

/* ------------------------------------------------------------------
   Lot 27 bis – correction entièrement automatique : réglages, décision,
   état d'une copie
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
  it("est actif par défaut, sans seuil", () => {
    expect(lireReglagesCorrectionAuto(() => "")).toEqual({ actif: true });
  });

  it("ne se désactive qu'avec l'interrupteur d'urgence CORRECTION_AUTO=off", () => {
    const env = (v: Record<string, string>) => (n: string) => v[n] ?? "";
    expect(lireReglagesCorrectionAuto(env({ CORRECTION_AUTO: "off" })).actif).toBe(false);
    expect(lireReglagesCorrectionAuto(env({ CORRECTION_AUTO: "non" })).actif).toBe(false);
    expect(lireReglagesCorrectionAuto(env({ CORRECTION_AUTO: "on" })).actif).toBe(true);
    // L'ancien seuil n'a plus d'effet.
    expect(lireReglagesCorrectionAuto(env({ CORRECTION_SEUIL: "0.99" }))).toEqual({ actif: true });
  });
});

describe("decisionAutomatique", () => {
  it("pose la note de chaque proposition, quelle que soit la confiance", () => {
    const notes = decisionAutomatique(
      { q1: proposition({ confiance: 0.2 }), q2: proposition({ verdict: "non_acquise", confiance: 0.5, feedback_apprenant: "Il manque…" }) },
      ["q1", "q2"]
    );
    expect(notes).toEqual({ q1: { acquise: true, commentaire: "Bien." }, q2: { acquise: false, commentaire: "Il manque…" } });
  });

  it("tranche « non acquise » pour un ancien verdict incertain et remplace un feedback vide", () => {
    expect(decisionAutomatique({ q1: proposition({ verdict: "incertain", feedback_apprenant: "Doute." }) }, ["q1"])).toEqual({
      q1: { acquise: false, commentaire: "Doute." },
    });
    expect(decisionAutomatique({ q1: proposition({ feedback_apprenant: "" }) }, ["q1"])).toEqual({
      q1: { acquise: true, commentaire: COMMENTAIRE_SANS_FEEDBACK },
    });
  });

  it("renvoie null seulement si une réponse n'a pas de correction (à relancer)", () => {
    expect(decisionAutomatique({ q1: proposition() }, ["q1", "q2"])).toBeNull();
    expect(decisionAutomatique({}, [])).toBeNull();
  });

  it("note non acquise une réponse vide ou trop courte, sans appel au modèle", () => {
    const p = propositionReponseInsuffisante();
    expect(p.verdict).toBe("non_acquise");
    expect(p.feedback_apprenant).toMatch(/trop courte/);
    expect(decisionAutomatique({ q1: p }, ["q1"])).toEqual({ q1: { acquise: false, commentaire: p.feedback_apprenant } });
    expect(p.feedback_apprenant).not.toMatch(/IA|DeepSeek|modèle|formateur/i);
  });
});

describe("état d'une copie", () => {
  const auto = { decision: { mode: "automatique", le: "2026-10-20T10:00:00Z" } };
  it("lit la décision", () => {
    expect(lireDecision(auto)?.mode).toBe("automatique");
    expect(lireDecision({ decision: { mode: "autre" } })).toBeNull();
    expect(lireDecision(null)).toBeNull();
    expect(estCorrigeeAutomatiquement(auto)).toBe(true);
    expect(estCorrigeeAutomatiquement({ decision: { mode: "humaine", le: "x" } })).toBe(false);
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

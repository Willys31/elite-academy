import { describe, expect, it } from "vitest";
import { validerResultat } from "@/lib/ai/schema";

/* ------------------------------------------------------------------
   Lot 25 – schéma v2 : activités, compétences par leçon, media_brief
   ------------------------------------------------------------------ */

const BASE = {
  course: { title: "Hygiène et sécurité en cuisine", description: "d", target_audience: "cuisiniers", prerequisites: "", duration_minutes: 240, objectives: ["o"] },
  competencies: [
    { name: "Appliquer la marche en avant", domain: "restauration", description: "…", target_level: "operational" },
    { name: "Contrôler les températures", domain: "restauration", description: "…", target_level: "fundamentals" },
  ],
};

function v2() {
  return {
    ...BASE,
    modules: [
      {
        title: "Module 1",
        description: "d",
        level: "FUNDAMENTALS",
        lessons: [
          {
            title: "La marche en avant",
            text: "Contenu…",
            estimated_minutes: 30,
            competency_refs: ["Appliquer la marche en avant", "Appliquer la marche en avant", " "],
            situation_type: "Apport",
            media_brief: { kind: "Video", purpose: "montrer le circuit", description: "plan séquence en cuisine" },
            activities: [
              {
                type: "quiz",
                title: "Quiz marche en avant",
                instructions: "Répondez",
                expected_outcome: "3/3",
                evaluation: "automatique",
                difficulty: 2,
                competency_refs: ["Appliquer la marche en avant"],
                situation_type: "evaluation",
                questions: [
                  { prompt: "Q1", options: ["a", "b", "c"], correct_index: 1, explanation: "e" },
                  { prompt: "Q sans options", options: [], correct_index: 0 },
                ],
              },
              {
                type: "case_study",
                title: "Cas : livraison non conforme",
                instructions: "Analysez…",
                expected_outcome: "Décision argumentée",
                evaluation: "grille",
                difficulty: 9,
                competency_refs: ["Contrôler les températures"],
                situation_type: "etude_de_cas",
              },
              { type: "exercise" },
            ],
          },
        ],
      },
    ],
    methods_rationale: "…",
    warnings: [],
    validation_required: true,
  };
}

describe("validerResultat – champs v2", () => {
  it("lit les activités, les références de compétences, le type de situation et le média", () => {
    const a = validerResultat(v2());
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    const lecon = a.resultat.modules[0].lessons[0];
    expect(a.resultat.modules[0].level).toBe("fundamentals");
    expect(lecon.competency_refs).toEqual(["Appliquer la marche en avant"]);
    expect(lecon.situation_type).toBe("apport");
    expect(lecon.media_brief).toEqual({ kind: "video", purpose: "montrer le circuit", description: "plan séquence en cuisine" });
    expect(lecon.activities).toHaveLength(2);
    const [quiz, cas] = lecon.activities;
    expect(quiz.type).toBe("quiz");
    expect(quiz.questions).toHaveLength(1);
    expect(quiz.questions[0].correct_index).toBe(1);
    expect(cas.type).toBe("case_study");
    expect(cas.difficulty).toBe(2);
    expect(cas.competency_refs).toEqual(["Contrôler les températures"]);
    expect(cas.questions).toEqual([]);
  });

  it("un résultat v1 reste valide, avec des champs v2 vides", () => {
    const a = validerResultat({
      ...BASE,
      modules: [{ title: "M", description: "", lessons: [{ title: "L", text: "t", estimated_minutes: 10 }] }],
      methods_rationale: "",
      warnings: [],
      validation_required: true,
    });
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    const lecon = a.resultat.modules[0].lessons[0];
    expect(lecon.competency_refs).toEqual([]);
    expect(lecon.situation_type).toBeNull();
    expect(lecon.media_brief).toBeNull();
    expect(lecon.activities).toEqual([]);
    expect(a.resultat.modules[0].level).toBeNull();
  });

  it("conserve un media_brief mal formé pour que le contrôle pédagogique le signale", () => {
    const r = v2();
    r.modules[0].lessons[0].media_brief = { kind: "hologramme", purpose: "", description: "" } as never;
    const a = validerResultat(r);
    if (!a.ok) throw new Error(a.erreur);
    expect(a.resultat.modules[0].lessons[0].media_brief).toEqual({ kind: "hologramme", purpose: "", description: "" });
  });

  it("ignore un niveau de module inconnu et un média vide", () => {
    const r = v2();
    r.modules[0].level = "expert";
    r.modules[0].lessons[0].media_brief = {} as never;
    const a = validerResultat(r);
    if (!a.ok) throw new Error(a.erreur);
    expect(a.resultat.modules[0].level).toBeNull();
    expect(a.resultat.modules[0].lessons[0].media_brief).toBeNull();
  });
});

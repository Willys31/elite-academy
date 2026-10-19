import { describe, expect, it } from "vitest";
import {
  avertissementsEnTexte,
  bornesExercicesDepuis,
  controlerPlan,
  sujetEstCommercial,
} from "@/lib/ai/controle-pedagogique";
import { validerResultat, type ResultatGeneration } from "@/lib/ai/schema";

/* ------------------------------------------------------------------
   Lot 25 – contrôles pédagogiques : un cas valide et un cas fautif par règle
   ------------------------------------------------------------------ */

function activite(extra: Record<string, unknown> = {}) {
  return {
    type: "exercise",
    title: "Exercice",
    instructions: "Faites…",
    expected_outcome: "…",
    evaluation: "grille",
    difficulty: 2,
    competency_refs: ["Conduire un entretien"],
    situation_type: "exercice_guide",
    ...extra,
  };
}

function plan(modifier: (r: Record<string, unknown>) => void = () => {}): ResultatGeneration {
  const brut: Record<string, unknown> = {
    course: { title: "Entretien annuel", description: "", target_audience: "", prerequisites: "", duration_minutes: 60, objectives: [] },
    competencies: [
      { name: "Conduire un entretien", domain: "management", description: "", target_level: "operational" },
      { name: "Fixer un objectif", domain: "management", description: "", target_level: "operational" },
    ],
    modules: [
      {
        title: "M1",
        description: "",
        level: "fundamentals",
        lessons: [
          {
            title: "L1",
            text: "Contenu",
            estimated_minutes: 20,
            competency_refs: ["Conduire un entretien"],
            situation_type: "apport",
            activities: [activite(), activite({ competency_refs: ["Fixer un objectif"], type: "case_study" })],
          },
        ],
      },
    ],
    methods_rationale: "",
    warnings: [],
    validation_required: true,
  };
  modifier(brut);
  const a = validerResultat(brut);
  if (!a.ok) throw new Error(a.erreur);
  return a.resultat;
}

const OPTIONS = { version: "v2" as const, sujetCommercial: false };
const lecon = (r: Record<string, unknown>) =>
  ((r.modules as Array<Record<string, unknown>>)[0].lessons as Array<Record<string, unknown>>)[0];

describe("controlerPlan – cas valide", () => {
  it("accepte un plan v2 complet sans erreur ni avertissement", () => {
    const c = controlerPlan(plan(), OPTIONS);
    expect(c.ok).toBe(true);
    expect(c.erreurs).toEqual([]);
    expect(c.avertissements).toEqual([]);
  });
});

describe("controlerPlan – compétences", () => {
  it("bloque une activité sans compétence existante", () => {
    const c = controlerPlan(plan((r) => ((lecon(r).activities as unknown[])[0] = activite({ competency_refs: ["Inconnue"] }))), OPTIONS);
    expect(c.ok).toBe(false);
    expect(c.erreurs.map((e) => e.code)).toContain("ACTIVITE_SANS_COMPETENCE");
    expect(c.avertissements.map((e) => e.code)).toContain("COMPETENCE_INCONNUE");
    expect(c.erreurs[0].chemin).toBe("modules[0].lessons[0].activities[0]");
  });

  it("bloque une compétence qu'aucune activité ne travaille", () => {
    const c = controlerPlan(plan((r) => ((lecon(r).activities as unknown[]).length = 1)), OPTIONS);
    expect(c.erreurs.map((e) => e.code)).toContain("COMPETENCE_NON_TRAVAILLEE");
    expect(c.erreurs[0].message).toContain("Fixer un objectif");
  });

  it("tolère la casse et les espaces dans les noms référencés", () => {
    const c = controlerPlan(plan((r) => ((lecon(r).activities as unknown[])[0] = activite({ competency_refs: ["  conduire un ENTRETIEN "] }))), OPTIONS);
    expect(c.ok).toBe(true);
  });

  it("avertit (sans bloquer) pour une leçon sans compétence", () => {
    const c = controlerPlan(plan((r) => (lecon(r).competency_refs = [])), OPTIONS);
    expect(c.ok).toBe(true);
    expect(c.avertissements.map((e) => e.code)).toContain("LECON_SANS_COMPETENCE");
  });
});

describe("controlerPlan – exercices par leçon", () => {
  it("bloque au-delà du maximum configuré", () => {
    const c = controlerPlan(plan(), { ...OPTIONS, bornes: { min: 1, max: 1 } });
    expect(c.erreurs.map((e) => e.code)).toContain("EXERCICES_TROP_NOMBREUX");
    expect(c.erreurs[0].message).toContain("maximum est 1");
  });

  it("avertit en dessous du minimum", () => {
    const c = controlerPlan(plan(), { ...OPTIONS, bornes: { min: 3, max: 5 } });
    expect(c.ok).toBe(true);
    expect(c.avertissements.map((e) => e.code)).toContain("EXERCICES_TROP_PEU");
  });

  it("lit les bornes depuis l'environnement avec repli sur les défauts", () => {
    expect(bornesExercicesDepuis(() => "")).toEqual({ min: 1, max: 3 });
    expect(bornesExercicesDepuis((n) => ({ LLM_EXERCICES_MIN: "2", LLM_EXERCICES_MAX: "4" })[n] ?? "")).toEqual({ min: 2, max: 4 });
    expect(bornesExercicesDepuis((n) => ({ LLM_EXERCICES_MIN: "5", LLM_EXERCICES_MAX: "2" })[n] ?? "")).toEqual({ min: 1, max: 3 });
    expect(bornesExercicesDepuis((n) => ({ LLM_EXERCICES_MAX: "abc" })[n] ?? "")).toEqual({ min: 1, max: 3 });
  });
});

describe("controlerPlan – activités incomplètes", () => {
  it("bloque un quiz sans question valide", () => {
    const c = controlerPlan(plan((r) => ((lecon(r).activities as unknown[])[0] = activite({ type: "quiz", questions: [] }))), OPTIONS);
    expect(c.erreurs.map((e) => e.code)).toContain("QUIZ_SANS_QUESTION");
  });

  it("bloque une activité sans consigne", () => {
    const c = controlerPlan(plan((r) => ((lecon(r).activities as unknown[])[0] = activite({ instructions: "" }))), OPTIONS);
    expect(c.erreurs.map((e) => e.code)).toContain("ACTIVITE_INCOMPLETE");
  });

  it("avertit pour un mode d'évaluation absent ou un type inconnu", () => {
    const c = controlerPlan(plan((r) => ((lecon(r).activities as unknown[])[0] = activite({ evaluation: "", type: "karaoke" }))), OPTIONS);
    expect(c.ok).toBe(true);
    const codes = c.avertissements.map((e) => e.code);
    expect(codes).toContain("ACTIVITE_INCOMPLETE");
    expect(codes).toContain("TYPE_ACTIVITE_INCONNU");
  });
});

describe("controlerPlan – niveaux et progression", () => {
  it("avertit quand un module n'a pas de niveau valide", () => {
    const c = controlerPlan(plan((r) => ((r.modules as Array<Record<string, unknown>>)[0].level = "expert")), OPTIONS);
    expect(c.avertissements.map((e) => e.code)).toContain("NIVEAU_MODULE_ABSENT");
  });

  it("avertit quand la progression des modules redescend", () => {
    const c = controlerPlan(
      plan((r) => {
        const m = r.modules as Array<Record<string, unknown>>;
        m[0].level = "advanced";
        m.push({ ...m[0], title: "M2", level: "fundamentals" });
      }),
      OPTIONS
    );
    expect(c.avertissements.map((e) => e.code)).toContain("PROGRESSION_INCOHERENTE");
    expect(c.avertissements.find((e) => e.code === "PROGRESSION_INCOHERENTE")?.chemin).toBe("modules[1]");
  });

  it("accepte une progression croissante ou stable", () => {
    const c = controlerPlan(
      plan((r) => {
        const m = r.modules as Array<Record<string, unknown>>;
        m.push({ ...m[0], title: "M2", level: "fundamentals" }, { ...m[0], title: "M3", level: "elite" });
      }),
      OPTIONS
    );
    expect(c.avertissements.map((e) => e.code)).not.toContain("PROGRESSION_INCOHERENTE");
  });
});

describe("controlerPlan – méthodes commerciales", () => {
  it("avertit quand SONCASE ou CAB apparaît dans un sujet non commercial", () => {
    const c = controlerPlan(plan((r) => (lecon(r).text = "Appliquez la méthode SONCASE à votre collaborateur.")), OPTIONS);
    expect(c.ok).toBe(true);
    const a = c.avertissements.find((e) => e.code === "METHODE_COMMERCIALE_INJUSTIFIEE");
    expect(a?.message).toContain("SONCASE");
    expect(a?.chemin).toBe("modules[0].lessons[0]");
  });

  it("ne dit rien pour un sujet commercial", () => {
    const c = controlerPlan(plan((r) => (lecon(r).text = "Méthode CAB et vente additionnelle.")), { ...OPTIONS, sujetCommercial: true });
    expect(c.avertissements.map((e) => e.code)).not.toContain("METHODE_COMMERCIALE_INJUSTIFIEE");
  });

  it("ne confond pas « cab » dans un mot courant", () => {
    const c = controlerPlan(plan((r) => (lecon(r).text = "Le cabinet médical et la cabine d'essayage.")), OPTIONS);
    expect(c.avertissements.map((e) => e.code)).not.toContain("METHODE_COMMERCIALE_INJUSTIFIEE");
  });

  it("déduit le caractère commercial du brief", () => {
    expect(sujetEstCommercial({ sujet: "Gestion des conflits", secteur: "santé" })).toBe(false);
    expect(sujetEstCommercial({ sujet: "Accueil du client en boutique" })).toBe(true);
    expect(sujetEstCommercial({ sujet: "Encadrer une équipe", public_cible: "vendeurs" })).toBe(true);
  });
});

describe("controlerPlan – media_brief et situation", () => {
  it("accepte un media_brief bien formé", () => {
    const c = controlerPlan(plan((r) => (lecon(r).media_brief = { kind: "video", purpose: "montrer", description: "plan séquence" })), OPTIONS);
    expect(c.avertissements).toEqual([]);
  });

  it("avertit pour un media_brief mal formé (type inconnu, description vide)", () => {
    const c = controlerPlan(plan((r) => (lecon(r).media_brief = { kind: "hologramme", purpose: "x", description: "" })), OPTIONS);
    const a = c.avertissements.find((e) => e.code === "MEDIA_BRIEF_INVALIDE");
    expect(a?.message).toContain("hologramme");
    expect(a?.message).toContain('"description" est vide');
  });

  it("avertit pour un situation_type absent ou inconnu", () => {
    const c = controlerPlan(plan((r) => (lecon(r).situation_type = "karaoke")), OPTIONS);
    expect(c.avertissements.map((e) => e.code)).toContain("SITUATION_INCONNUE");
  });
});

describe("controlerPlan – version v1 et formatage", () => {
  it("en v1, n'exige ni compétences par activité ni situation, mais signale les méthodes commerciales", () => {
    const c = controlerPlan(
      plan((r) => {
        const l = lecon(r);
        l.competency_refs = [];
        l.situation_type = undefined;
        l.activities = [];
        l.text = "Utilisez la méthode CAB.";
      }),
      { version: "v1", sujetCommercial: false }
    );
    expect(c.ok).toBe(true);
    expect(c.avertissements.map((e) => e.code)).toEqual(["METHODE_COMMERCIALE_INJUSTIFIEE"]);
  });

  it("formate les avertissements pour warnings avec le code", () => {
    const c = controlerPlan(plan((r) => (lecon(r).competency_refs = [])), OPTIONS);
    const t = avertissementsEnTexte(c.avertissements);
    expect(t[0]).toMatch(/^\[contrôle LECON_SANS_COMPETENCE\] /);
  });
});

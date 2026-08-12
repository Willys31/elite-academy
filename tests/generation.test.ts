import { describe, expect, it } from "vitest";
import { extraireJson, validerResultat } from "@/lib/ai/schema";
import { genererSimulation } from "@/lib/ai/simulation";

const RESULTAT_VALIDE = {
  course: {
    title: "Gestion des conflits internes",
    description: "Formation pratique pour managers débutants.",
    target_audience: "Managers débutants",
    prerequisites: "Aucun",
    duration_minutes: 420,
    objectives: ["Identifier les sources de conflit", "Conduire une médiation"],
  },
  competencies: [
    {
      name: "Conduire un entretien de médiation",
      domain: "management",
      description: "Mène un entretien structuré entre deux collaborateurs.",
      target_level: "operational",
    },
  ],
  modules: [
    {
      title: "Comprendre le conflit",
      description: "Identifier les mécanismes.",
      lessons: [
        {
          title: "Les sources de conflit",
          text: "Contenu pédagogique complet…",
          estimated_minutes: 30,
        },
      ],
    },
  ],
  methods_rationale: "Études de cas et jeux de rôle, adaptés au management.",
  warnings: [],
  validation_required: true,
};

describe("extraireJson", () => {
  it("analyse un JSON pur", () => {
    expect(extraireJson('{"a": 1}')).toEqual({ a: 1 });
  });

  it("tolère les balises de code", () => {
    expect(extraireJson('```json\n{"a": 1}\n```')).toEqual({ a: 1 });
  });

  it("tolère du texte avant et après", () => {
    expect(extraireJson('Voici le résultat :\n{"a": 1}\nBonne journée.')).toEqual({
      a: 1,
    });
  });

  it("retourne null si aucun JSON exploitable", () => {
    expect(extraireJson("Désolé, je ne peux pas répondre.")).toBeNull();
    expect(extraireJson("{invalide}")).toBeNull();
  });
});

describe("validerResultat", () => {
  it("accepte un résultat complet et le normalise", () => {
    const analyse = validerResultat(RESULTAT_VALIDE);
    expect(analyse.ok).toBe(true);
    if (analyse.ok) {
      expect(analyse.resultat.course.title).toBe("Gestion des conflits internes");
      expect(analyse.resultat.competencies).toHaveLength(1);
      expect(analyse.resultat.modules[0].lessons[0].estimated_minutes).toBe(30);
      expect(analyse.resultat.validation_required).toBe(true);
    }
  });

  it("rejette un résultat sans titre", () => {
    const analyse = validerResultat({ ...RESULTAT_VALIDE, course: { title: "" } });
    expect(analyse.ok).toBe(false);
    if (!analyse.ok) expect(analyse.erreur).toContain("titre");
  });

  it("rejette un résultat sans compétence", () => {
    const analyse = validerResultat({ ...RESULTAT_VALIDE, competencies: [] });
    expect(analyse.ok).toBe(false);
    if (!analyse.ok) expect(analyse.erreur).toContain("compétence");
  });

  it("rejette un résultat sans module ni leçon", () => {
    expect(validerResultat({ ...RESULTAT_VALIDE, modules: [] }).ok).toBe(false);
    const sansLecons = {
      ...RESULTAT_VALIDE,
      modules: [{ title: "Module", description: "", lessons: [] }],
    };
    expect(validerResultat(sansLecons).ok).toBe(false);
  });

  it("corrige un niveau invalide vers fundamentals", () => {
    const analyse = validerResultat({
      ...RESULTAT_VALIDE,
      competencies: [
        { name: "X", domain: "d", description: "", target_level: "expert" },
      ],
    });
    expect(analyse.ok).toBe(true);
    if (analyse.ok) {
      expect(analyse.resultat.competencies[0].target_level).toBe("fundamentals");
    }
  });

  it("force validation_required à true si absent", () => {
    const sans = { ...RESULTAT_VALIDE } as Record<string, unknown>;
    delete sans.validation_required;
    const analyse = validerResultat(sans);
    expect(analyse.ok).toBe(true);
    if (analyse.ok) expect(analyse.resultat.validation_required).toBe(true);
  });

  it("rejette les types inattendus", () => {
    expect(validerResultat(null).ok).toBe(false);
    expect(validerResultat("texte").ok).toBe(false);
    expect(validerResultat(42).ok).toBe(false);
  });

  it("le mode simulation produit un résultat valide et clairement étiqueté", () => {
    const texte = genererSimulation({
      sujet: "Formation gestion des conflits internes pour managers débutants",
      public_cible: "managers débutants",
      secteur: "management",
    });
    const analyse = validerResultat(extraireJson(texte));
    expect(analyse.ok).toBe(true);
    if (analyse.ok) {
      expect(analyse.resultat.course.title).toContain("[DÉMO]");
      expect(analyse.resultat.validation_required).toBe(true);
      expect(
        analyse.resultat.warnings.some((w) => w.includes("DÉMONSTRATION"))
      ).toBe(true);
      expect(analyse.resultat.modules.length).toBeGreaterThan(0);
      expect(analyse.resultat.competencies.length).toBeGreaterThan(0);
    }
  });

  it("borne les listes excessives", () => {
    const beaucoup = {
      ...RESULTAT_VALIDE,
      warnings: Array.from({ length: 50 }, (_, i) => `alerte ${i}`),
    };
    const analyse = validerResultat(beaucoup);
    expect(analyse.ok).toBe(true);
    if (analyse.ok) expect(analyse.resultat.warnings.length).toBeLessThanOrEqual(20);
  });
});

import { describe, expect, it } from "vitest";
import {
  activiteDepuisPlan,
  estActiviteRedigee,
  grilleDepuisActivite,
  lireContenuActiviteRedigee,
  lireFormulaireActiviteRedigee,
  lireTypeActiviteRedigee,
  LONGUEUR_MAX_CONSIGNE,
  retirerBlocActivites,
  TYPE_ACTIVITE_REDIGEE_LABELS,
} from "@/lib/courses/activites-redigees";
import type { ActiviteGeneree } from "@/lib/ai/schema";

/* ------------------------------------------------------------------
   Lot 26 – activités rédigées : lecture, conversion du plan, formulaire
   ------------------------------------------------------------------ */

function activite(extra: Partial<ActiviteGeneree> = {}): ActiviteGeneree {
  return {
    type: "case_study",
    title: "Livraison douteuse un vendredi soir",
    instructions: "Contexte : service dans deux heures… Questions : quelle décision prenez-vous ?",
    expected_outcome: "Refus ou mise en attente du lot, information du second.",
    evaluation: "Grille : décision conforme (2), personnes prévenues (1), traçabilité (1), justification (1).",
    difficulty: 3,
    competency_refs: ["Contrôler et enregistrer les températures"],
    situation_type: "etude_de_cas",
    media_brief: null,
    questions: [],
    ...extra,
  };
}

describe("types", () => {
  it("reconnaît les trois types rédigés et leurs libellés", () => {
    expect(estActiviteRedigee("exercise")).toBe(true);
    expect(estActiviteRedigee("simulation")).toBe(true);
    expect(estActiviteRedigee("quiz")).toBe(false);
    expect(estActiviteRedigee(null)).toBe(false);
    expect(lireTypeActiviteRedigee("karaoke")).toBe("exercise");
    expect(TYPE_ACTIVITE_REDIGEE_LABELS.case_study).toBe("Étude de cas");
  });
});

describe("lireContenuActiviteRedigee", () => {
  it("lit un contenu complet", () => {
    const c = lireContenuActiviteRedigee({
      expected_outcome: " livrable ",
      evaluation: "grille",
      situation_type: "simulation",
      competency_refs: ["A", "", 3, "B"],
      media_brief: { kind: "Video", purpose: "p", description: "d" },
      generated_by_ai: true,
      prompt_version: "plan-formation/v2",
    });
    expect(c.expected_outcome).toBe("livrable");
    expect(c.competency_refs).toEqual(["A", "B"]);
    expect(c.media_brief).toEqual({ kind: "video", purpose: "p", description: "d" });
    expect(c.generated_by_ai).toBe(true);
    expect(c.prompt_version).toBe("plan-formation/v2");
  });

  it("tolère un contenu vide, nul ou mal formé", () => {
    for (const brut of [null, undefined, "texte", [], {}]) {
      const c = lireContenuActiviteRedigee(brut);
      expect(c.expected_outcome).toBe("");
      expect(c.competency_refs).toEqual([]);
      expect(c.media_brief).toBeNull();
      expect(c.generated_by_ai).toBe(false);
    }
  });
});

describe("activiteDepuisPlan", () => {
  it("convertit une étude de cas du plan v2 en activité + question ouverte + compétences", () => {
    const r = activiteDepuisPlan(activite(), { prompt_version: "plan-formation/v2" });
    expect(r).not.toBeNull();
    if (!r) return;
    expect(r.activite.type).toBe("case_study");
    expect(r.activite.title).toBe("Livraison douteuse un vendredi soir");
    expect(r.activite.difficulty).toBe(3);
    expect(r.activite.content.evaluation).toContain("Grille");
    expect(r.activite.content.generated_by_ai).toBe(true);
    expect(r.question.type).toBe("open");
    expect(r.question.prompt).toBe(r.activite.instructions);
    expect(r.question.expected_answer.rubric).toContain("Résultat attendu : Refus");
    expect(r.question.expected_answer.rubric).toContain("Critères d'évaluation : Grille");
    expect(r.competences).toEqual(["Contrôler et enregistrer les températures"]);
  });

  it("ignore les quiz et les activités sans consigne, et ramène open_question à un exercice", () => {
    expect(activiteDepuisPlan(activite({ type: "quiz" }), { prompt_version: "v" })).toBeNull();
    expect(activiteDepuisPlan(activite({ instructions: "  " }), { prompt_version: "v" })).toBeNull();
    expect(activiteDepuisPlan(activite({ type: "open_question" }), { prompt_version: "v" })?.activite.type).toBe("exercise");
    expect(activiteDepuisPlan(activite({ type: "inconnu" }), { prompt_version: "v" })?.activite.type).toBe("exercise");
  });

  it("borne la difficulté et la longueur des champs", () => {
    const r = activiteDepuisPlan(activite({ difficulty: 42, instructions: "x".repeat(LONGUEUR_MAX_CONSIGNE + 50) }), { prompt_version: "v" });
    expect(r?.activite.difficulty).toBe(2);
    expect(r?.activite.instructions.length).toBe(LONGUEUR_MAX_CONSIGNE);
  });

  it("construit une grille même sans résultat attendu", () => {
    expect(grilleDepuisActivite({ expected_outcome: "", evaluation: "c" })).toBe("Critères d'évaluation : c");
    expect(grilleDepuisActivite({ expected_outcome: "", evaluation: "" })).toBe("");
  });
});

describe("retirerBlocActivites", () => {
  it("retire le bloc ajouté au texte des leçons par le lot 25", () => {
    const texte = "Contenu de la leçon.\n\nPoints à retenir.\n\n— Activités —\n\nExercice — Titre\nConsigne : …";
    expect(retirerBlocActivites(texte)).toBe("Contenu de la leçon.\n\nPoints à retenir.");
    expect(retirerBlocActivites("Sans bloc")).toBe("Sans bloc");
  });
});

describe("lireFormulaireActiviteRedigee", () => {
  const champs = (v: Record<string, string>) => (nom: string) => v[nom] ?? "";

  it("accepte un formulaire complet", () => {
    const r = lireFormulaireActiviteRedigee(
      champs({ type: "simulation", title: "Trois clients", instructions: "Rôle : vendeur…", expected_outcome: "Accueil adapté", evaluation: "Grille 5 points", difficulty: "4", situation_type: "simulation" })
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.valeur.activite.type).toBe("simulation");
    expect(r.valeur.activite.difficulty).toBe(4);
    expect(r.valeur.activite.content.generated_by_ai).toBe(false);
    expect(r.valeur.question.expected_answer.rubric).toContain("Grille 5 points");
  });

  it("refuse l'absence de titre, de consigne ou de critères avec un message clair", () => {
    expect(lireFormulaireActiviteRedigee(champs({ instructions: "c", evaluation: "e" }))).toMatchObject({ ok: false, erreur: expect.stringContaining("titre") });
    expect(lireFormulaireActiviteRedigee(champs({ title: "t", evaluation: "e" }))).toMatchObject({ ok: false, erreur: expect.stringContaining("consigne") });
    expect(lireFormulaireActiviteRedigee(champs({ title: "t", instructions: "c" }))).toMatchObject({ ok: false, erreur: expect.stringContaining("critères") });
  });

  it("borne les longueurs et la difficulté", () => {
    expect(lireFormulaireActiviteRedigee(champs({ title: "t", instructions: "x".repeat(LONGUEUR_MAX_CONSIGNE + 1), evaluation: "e" })).ok).toBe(false);
    const r = lireFormulaireActiviteRedigee(champs({ title: "t", instructions: "c", evaluation: "e", difficulty: "9" }));
    expect(r.ok && r.valeur.activite.difficulty).toBe(2);
  });
});

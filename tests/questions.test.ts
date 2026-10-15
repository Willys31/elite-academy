import { describe, expect, it } from "vitest";
import {
  estCorrigeAutomatiquement,
  estEnAttenteDeCorrection,
  estReponseLibre,
  lireQuestion,
  lireReponse,
  lireReponsesAcceptees,
  lireTypeQuestion,
  LONGUEUR_MAX_REPONSE_LIBRE,
  normaliserReponseCourte,
  OPTIONS_VRAI_FAUX,
  reponseCourteAcceptee,
} from "@/lib/courses/questions";
import {
  appliquerNotes,
  corrigerQcm,
  scorePourCompetence,
  tentativeEnAttente,
} from "@/lib/courses/progression";

describe("lireTypeQuestion", () => {
  it("reconnaît les quatre types et retombe sur le QCM", () => {
    expect(lireTypeQuestion("true_false")).toBe("true_false");
    expect(lireTypeQuestion("short_answer")).toBe("short_answer");
    expect(lireTypeQuestion("open")).toBe("open");
    expect(lireTypeQuestion("qcm")).toBe("qcm");
    expect(lireTypeQuestion(undefined)).toBe("qcm");
    expect(lireTypeQuestion("multiple")).toBe("qcm");
  });

  it("distingue correction automatique et réponse libre", () => {
    expect(estCorrigeAutomatiquement("open")).toBe(false);
    expect(estCorrigeAutomatiquement("short_answer")).toBe(true);
    expect(estReponseLibre("short_answer")).toBe(true);
    expect(estReponseLibre("open")).toBe(true);
    expect(estReponseLibre("true_false")).toBe(false);
  });
});

describe("normaliserReponseCourte", () => {
  it("ignore casse, accents, espaces multiples et ponctuation de bord", () => {
    expect(normaliserReponseCourte("  L'Éducation   NATIONALE. ")).toBe("l'education nationale");
    expect(normaliserReponseCourte("« Façade »")).toBe("facade");
    expect(normaliserReponseCourte("l’élève")).toBe("l'eleve");
  });

  it("accepte une réponse équivalente et refuse le reste", () => {
    const acceptees = ["Photosynthèse", "la photosynthese"];
    expect(reponseCourteAcceptee("PHOTOSYNTHESE", acceptees)).toBe(true);
    expect(reponseCourteAcceptee("  la Photosynthèse !", acceptees)).toBe(true);
    expect(reponseCourteAcceptee("respiration", acceptees)).toBe(false);
    expect(reponseCourteAcceptee("", acceptees)).toBe(false);
    expect(reponseCourteAcceptee(null, acceptees)).toBe(false);
    expect(reponseCourteAcceptee("   ", acceptees)).toBe(false);
  });
});

describe("lireReponsesAcceptees", () => {
  it("lit une réponse par ligne ou par point-virgule, sans vides ni doublons", () => {
    expect(lireReponsesAcceptees("Paris\n paris ; PARIS\n\nLutèce")).toEqual(["Paris", "Lutèce"]);
    expect(lireReponsesAcceptees("   ")).toEqual([]);
  });
});

describe("lireQuestion", () => {
  it("lit un vrai/faux et impose ses deux options", () => {
    const q = lireQuestion({
      id: "q",
      type: "true_false",
      prompt: "La Terre est plate.",
      options: ["Vrai", "Faux", "Peut-être"],
      expected_answer: { index: 1 },
    });
    expect(q.options).toEqual([...OPTIONS_VRAI_FAUX]);
    expect(q.bonneReponse).toBe(1);
  });

  it("lit une réponse courte et ses réponses acceptées", () => {
    const q = lireQuestion({
      id: "q",
      type: "short_answer",
      prompt: "Capitale ?",
      expected_answer: { accepted: ["Paris", 3, "Lutèce"] },
    });
    expect(q.acceptees).toEqual(["Paris", "Lutèce"]);
    expect(q.bonneReponse).toBe(-1);
    expect(q.options).toEqual([]);
  });

  it("lit une question ouverte et sa grille", () => {
    const q = lireQuestion({
      id: "q",
      type: "open",
      prompt: "Expliquez.",
      expected_answer: { rubric: "Citer deux causes." },
      explanation: null,
      competency_id: "c1",
    });
    expect(q.grille).toBe("Citer deux causes.");
    expect(q.competencyId).toBe("c1");
  });

  it("tolère une ligne ancienne sans type ni corrigé", () => {
    const q = lireQuestion({ id: "q", prompt: "?", options: ["A", "B"], expected_answer: {} });
    expect(q.type).toBe("qcm");
    expect(q.bonneReponse).toBe(-1);
  });
});

describe("lireReponse", () => {
  it("lit un index pour un choix, un texte pour une réponse libre", () => {
    expect(lireReponse("qcm", "2")).toBe(2);
    expect(lireReponse("true_false", "0")).toBe(0);
    expect(lireReponse("qcm", "abc")).toBeNull();
    expect(lireReponse("qcm", "-1")).toBeNull();
    expect(lireReponse("short_answer", "  Paris ")).toBe("Paris");
    expect(lireReponse("open", "   ")).toBeNull();
    expect(lireReponse("open", null)).toBeNull();
  });

  it("borne la longueur d'une réponse libre", () => {
    const longue = "a".repeat(LONGUEUR_MAX_REPONSE_LIBRE + 50);
    expect((lireReponse("open", longue) as string).length).toBe(LONGUEUR_MAX_REPONSE_LIBRE);
  });
});

const QUESTIONS = [
  lireQuestion({ id: "vf", type: "true_false", prompt: "VF", options: ["Vrai", "Faux"], expected_answer: { index: 0 }, competency_id: "A" }),
  lireQuestion({ id: "rc", type: "short_answer", prompt: "RC", expected_answer: { accepted: ["Été"] }, competency_id: "A" }),
  lireQuestion({ id: "qo", type: "open", prompt: "QO", expected_answer: { rubric: "Deux idées" }, competency_id: "B" }),
  lireQuestion({ id: "qcm", type: "qcm", prompt: "QCM", options: ["A", "B", "C"], expected_answer: { index: 2 }, competency_id: "B" }),
];

describe("corrigerQcm avec les quatre types", () => {
  it("corrige vrai/faux, réponse courte et QCM, laisse la question ouverte en attente", () => {
    const r = corrigerQcm(QUESTIONS, { vf: 0, rc: "ete", qo: "Ma réponse rédigée.", qcm: 1 });
    expect(r.details.map((d) => d.correcte)).toEqual([true, true, null, false]);
    expect(r.nbEnAttente).toBe(1);
    expect(r.scorePourcent).toBeNull();
    expect(tentativeEnAttente(r)).toBe(true);
    expect(r.details[1].reponseAttendue).toBe("Été");
    expect(r.details[2].reponseDonnee).toBe("Ma réponse rédigée.");
    expect(r.details[2].bonneReponse).toBe(-1);
  });

  it("une question ouverte sans réponse est ratée, pas en attente", () => {
    const r = corrigerQcm(QUESTIONS, { vf: 0, rc: "été", qcm: 2 });
    expect(r.details[2].correcte).toBe(false);
    expect(r.nbEnAttente).toBe(0);
    expect(r.scorePourcent).toBe(75);
  });

  it("un texte envoyé à un choix ou un nombre à une réponse libre vaut « pas de réponse »", () => {
    const r = corrigerQcm(QUESTIONS, { vf: "Vrai", rc: 1 });
    expect(r.details[0].reponseDonnee).toBeNull();
    expect(r.details[1].reponseDonnee).toBeNull();
  });

  it("reste compatible avec les QCM sans type", () => {
    const r = corrigerQcm(
      [{ id: "q1", prompt: "?", options: ["A", "B"], bonneReponse: 1 }],
      { q1: 1 }
    );
    expect(r.details[0].type).toBe("qcm");
    expect(r.scorePourcent).toBe(100);
    expect(r.nbEnAttente).toBe(0);
  });
});

describe("appliquerNotes", () => {
  const enAttente = corrigerQcm(QUESTIONS, { vf: 0, rc: "été", qo: "Réponse", qcm: 2 });

  it("pose la note et le commentaire, puis recalcule le score", () => {
    const { correction, sansNote } = appliquerNotes(enAttente, {
      qo: { acquise: true, commentaire: "  Bien argumenté. " },
    });
    expect(sansNote).toEqual([]);
    expect(correction.details[2].correcte).toBe(true);
    expect(correction.details[2].commentaire).toBe("Bien argumenté.");
    expect(correction.scorePourcent).toBe(100);
    expect(correction.nbEnAttente).toBe(0);
    expect(tentativeEnAttente(correction)).toBe(false);
  });

  it("une note « non acquise » compte comme fausse", () => {
    const { correction } = appliquerNotes(enAttente, { qo: { acquise: false, commentaire: null } });
    expect(correction.details[2].correcte).toBe(false);
    expect(correction.scorePourcent).toBe(75);
  });

  it("signale les questions ouvertes restées sans note", () => {
    const { correction, sansNote } = appliquerNotes(enAttente, {});
    expect(sansNote).toEqual(["qo"]);
    expect(correction.scorePourcent).toBeNull();
  });

  it("ne touche jamais aux questions corrigées automatiquement", () => {
    const { correction } = appliquerNotes(enAttente, {
      vf: { acquise: false, commentaire: "tentative de triche" },
      qo: { acquise: true, commentaire: null },
    });
    expect(correction.details[0].correcte).toBe(true);
    expect(correction.details[0].commentaire).toBeNull();
  });
});

describe("scorePourCompetence et questions en attente", () => {
  const comp = { vf: "A", rc: "A", qo: "B", qcm: "B" };

  it("ne compte une question ouverte qu'une fois notée", () => {
    const attente = corrigerQcm(QUESTIONS, { vf: 0, rc: "été", qo: "Réponse", qcm: 2 });
    // Compétence A : deux questions automatiques justes.
    expect(scorePourCompetence({ score: null, feedback: attente }, "A", comp)).toBe(100);
    // Compétence B : le QCM est juste, la question ouverte attend → 100 % sur ce qui est noté.
    expect(scorePourCompetence({ score: null, feedback: attente }, "B", comp)).toBe(100);

    const notee = appliquerNotes(attente, { qo: { acquise: false, commentaire: null } }).correction;
    expect(scorePourCompetence({ score: notee.scorePourcent, feedback: notee }, "B", comp)).toBe(50);
  });

  it("ne produit aucune preuve quand toutes les questions de la compétence attendent", () => {
    const seule = corrigerQcm([QUESTIONS[2]], { qo: "Réponse" });
    expect(scorePourCompetence({ score: null, feedback: seule }, "B", { qo: "B" })).toBeNull();
  });
});

describe("estEnAttenteDeCorrection", () => {
  it("ne reconnaît que le statut pending_review", () => {
    expect(estEnAttenteDeCorrection("pending_review")).toBe(true);
    expect(estEnAttenteDeCorrection("graded")).toBe(false);
    expect(estEnAttenteDeCorrection(null)).toBe(false);
  });
});

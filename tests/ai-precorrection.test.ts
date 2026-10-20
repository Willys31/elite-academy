import { describe, expect, it } from "vitest";
import {
  construirePromptCorrection,
  PROMPT_VERSION_CORRECTION,
  SYSTEM_CORRECTION,
} from "@/lib/ai/prompts-correction";
import {
  ecartProposition,
  lireQuotaPrecorrections,
  propositionIncertaine,
  propositionVersNote,
  pseudonymiser,
  quotaAtteint,
  reponseTropCourte,
  resumerPropositions,
  validerPrecorrection,
  type PropositionCorrection,
} from "@/lib/ai/precorrection";
import { simulerPrecorrection } from "@/lib/ai/simulation";
import { extraireJson } from "@/lib/ai/json";

/* ------------------------------------------------------------------
   Lot 26 – pré-correction IA : prompt, validation, pseudonymisation
   ------------------------------------------------------------------ */

const PROPOSITION_VALIDE = {
  verdict: "acquise",
  confiance: 0.82,
  criteres: [
    { critere: "Décision conforme", atteint: true, observation: "Le lot est refusé." },
    { critere: "Traçabilité", atteint: false, observation: "Rien n'est écrit." },
    { critere: "", atteint: true, observation: "ignoré" },
  ],
  type_difficulte: null,
  points_forts: ["Décision rapide"],
  a_travailler: ["Écrire le motif du refus"],
  feedback_apprenant: "Votre décision de refuser le lot est la bonne. Vous prévenez la bonne personne. Il manque la trace écrite du refus. Notez systématiquement le motif sur le bon de livraison.",
  commentaire_formateur: "Vérifier si l'absence de trace écrite est rédhibitoire dans ce contexte.",
  warnings: [],
};

describe("prompt de pré-correction", () => {
  it("porte une version, exige du JSON et interdit le corrigé complet", () => {
    expect(PROMPT_VERSION_CORRECTION).toBe("precorrection-reponse/v1");
    expect(SYSTEM_CORRECTION).toMatch(/JSON/);
    expect(SYSTEM_CORRECTION).toContain("Ne rédige JAMAIS la réponse complète attendue");
    expect(SYSTEM_CORRECTION).toContain("formateur humain");
    for (const t of ["notion_non_comprise", "confusion", "mauvaise_lecture", "raisonnement_incomplet", "difficulte_application"]) {
      expect(SYSTEM_CORRECTION).toContain(t);
    }
  });

  it("contient consigne, critères, grille, compétence et réponse, sans identité", () => {
    const p = construirePromptCorrection({
      typeActivite: "case_study",
      titre: "Livraison douteuse",
      consigne: "Contexte : …",
      resultatAttendu: "Refus du lot",
      criteres: "décision (2), trace (1)",
      grille: "Résultat attendu : refus",
      competence: "Contrôler les températures",
      niveauCible: "fundamentals",
      reponse: "Je refuse le lot et je préviens le second.",
    });
    expect(p).toContain("étude de cas");
    expect(p).toContain("CONSIGNE DONNÉE");
    expect(p).toContain("décision (2), trace (1)");
    expect(p).toContain("GRILLE DU CONCEPTEUR");
    expect(p).toContain("Contrôler les températures (niveau cible : fundamentals)");
    expect(p).toContain("Je refuse le lot");
    expect(p).not.toMatch(/@/);
  });

  it("omet les blocs absents", () => {
    const p = construirePromptCorrection({
      typeActivite: "exercise", titre: "T", consigne: "C", resultatAttendu: null, criteres: null, grille: null, competence: null, niveauCible: null, reponse: "R",
    });
    expect(p).not.toContain("GRILLE");
    expect(p).not.toContain("Compétence visée");
    expect(p).toContain("exercice");
  });
});

describe("validerPrecorrection", () => {
  it("accepte et normalise une proposition complète", () => {
    const v = validerPrecorrection(PROPOSITION_VALIDE);
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.proposition.verdict).toBe("acquise");
    expect(v.proposition.confiance).toBe(0.82);
    expect(v.proposition.criteres).toHaveLength(2);
    expect(v.proposition.criteres[1].atteint).toBe(false);
    expect(v.proposition.type_difficulte).toBeNull();
    expect(v.proposition.a_travailler).toEqual(["Écrire le motif du refus"]);
  });

  it("refuse un verdict inconnu, un feedback vide ou un non-objet", () => {
    expect(validerPrecorrection({ ...PROPOSITION_VALIDE, verdict: "moyen" }).ok).toBe(false);
    expect(validerPrecorrection({ ...PROPOSITION_VALIDE, feedback_apprenant: "" }).ok).toBe(false);
    expect(validerPrecorrection(null).ok).toBe(false);
    expect(validerPrecorrection([1]).ok).toBe(false);
  });

  it("borne la confiance, ignore un type de difficulté inconnu, lit atteint null", () => {
    const v = validerPrecorrection({ ...PROPOSITION_VALIDE, confiance: 7, type_difficulte: "paresse", criteres: [{ critere: "x", atteint: "oui", observation: "" }] });
    if (!v.ok) throw new Error(v.erreur);
    expect(v.proposition.confiance).toBe(1);
    expect(v.proposition.type_difficulte).toBeNull();
    expect(v.proposition.criteres[0].atteint).toBeNull();
    const sans = validerPrecorrection({ ...PROPOSITION_VALIDE, confiance: "n/a" });
    expect(sans.ok && sans.proposition.confiance).toBe(0.5);
  });

  it("tronque le feedback trop long", () => {
    const v = validerPrecorrection({ ...PROPOSITION_VALIDE, feedback_apprenant: "x".repeat(2000) });
    expect(v.ok && v.proposition.feedback_apprenant.length).toBe(1200);
  });
});

describe("réponse trop courte et proposition incertaine", () => {
  it("juge une réponse de moins de 20 caractères trop courte", () => {
    expect(reponseTropCourte("")).toBe(true);
    expect(reponseTropCourte("Je ne sais pas.")).toBe(true);
    expect(reponseTropCourte("Je refuse le lot et je préviens le second de cuisine.")).toBe(false);
    expect(reponseTropCourte(null)).toBe(true);
  });

  it("construit une proposition incertaine sans feedback apprenant", () => {
    const p = propositionIncertaine("Réponse vide.");
    expect(p.verdict).toBe("incertain");
    expect(p.confiance).toBe(0);
    expect(p.feedback_apprenant).toBe("");
    expect(p.warnings).toEqual(["Réponse vide."]);
    expect(propositionVersNote(p)).toEqual({ acquise: false, commentaire: null });
  });
});

describe("pseudonymiser", () => {
  it("retire le nom complet, ses parties et les e-mails", () => {
    const t = pseudonymiser(
      "Moi, Awa Koné, je préviens Koné et j'écris à awa.kone@exemple.ci. Le lot est refusé.",
      ["Awa Koné", "awa.kone@exemple.ci"]
    );
    expect(t).not.toContain("Awa");
    expect(t).not.toContain("Koné");
    expect(t).not.toContain("awa.kone@exemple.ci");
    expect(t).toContain("[apprenant]");
    expect(t).toContain("Le lot est refusé.");
  });

  it("ne touche pas aux mots courants ni aux fragments trop courts", () => {
    expect(pseudonymiser("Le lot est refusé.", ["Lo Ba"])).toBe("Le lot est refusé.");
    expect(pseudonymiser("Bonjour", [null, undefined, ""])).toBe("Bonjour");
    expect(pseudonymiser("Je refuse. Contact : x@y.fr", [])).toBe("Je refuse. Contact : [e-mail]");
  });
});

describe("quota", () => {
  it("lit LLM_PRECORRECTIONS_PAR_JOUR avec repli sur 200 et 0 pour désactiver", () => {
    expect(lireQuotaPrecorrections(() => "")).toBe(200);
    expect(lireQuotaPrecorrections(() => "50")).toBe(50);
    expect(lireQuotaPrecorrections(() => "0")).toBe(0);
    expect(lireQuotaPrecorrections(() => "abc")).toBe(200);
    expect(quotaAtteint(0, 0)).toBe(true);
    expect(quotaAtteint(199, 200)).toBe(false);
    expect(quotaAtteint(200, 200)).toBe(true);
  });
});

describe("propositionVersNote et ecartProposition", () => {
  const acquise = (validerPrecorrection(PROPOSITION_VALIDE) as { ok: true; proposition: PropositionCorrection }).proposition;
  const nonAcquise = { ...acquise, verdict: "non_acquise" as const };

  it("pré-remplit la note avec le verdict et le feedback", () => {
    expect(propositionVersNote(acquise)).toEqual({ acquise: true, commentaire: acquise.feedback_apprenant });
    expect(propositionVersNote(nonAcquise).acquise).toBe(false);
  });

  it("validatedAsIs vaut vrai seulement si toutes les notes suivent la proposition", () => {
    const suit = ecartProposition({ q1: acquise, q2: nonAcquise }, { q1: { acquise: true, commentaire: null }, q2: { acquise: false, commentaire: "c" } });
    expect(suit.validatedAsIs).toBe(true);
    expect(suit.finalVerdicts.q2).toEqual({ acquise: false, commentaire: "c", verdict_propose: "non_acquise" });
    const contredit = ecartProposition({ q1: acquise }, { q1: { acquise: false, commentaire: null } });
    expect(contredit.validatedAsIs).toBe(false);
    const incertain = ecartProposition({ q1: { ...acquise, verdict: "incertain" } }, { q1: { acquise: true, commentaire: null } });
    expect(incertain.validatedAsIs).toBe(false);
    const sansProposition = ecartProposition({}, { q1: { acquise: true, commentaire: null } });
    expect(sansProposition.validatedAsIs).toBe(false);
    expect(sansProposition.finalVerdicts.q1.verdict_propose).toBeNull();
    expect(ecartProposition({ q1: acquise }, {}).validatedAsIs).toBe(false);
  });
});

describe("resumerPropositions", () => {
  const acquise = (validerPrecorrection(PROPOSITION_VALIDE) as { ok: true; proposition: PropositionCorrection }).proposition;
  it("résume une ou plusieurs propositions pour la file des copies", () => {
    expect(resumerPropositions(null)).toBeNull();
    expect(resumerPropositions({})).toBeNull();
    expect(resumerPropositions({ q1: acquise })).toBe("IA : acquise (82 %)");
    expect(resumerPropositions({ q1: { ...acquise, verdict: "incertain" } })).toBe("IA : incertain");
    expect(resumerPropositions({ q1: acquise, q2: { ...acquise, verdict: "non_acquise" }, q3: { ...acquise, verdict: "incertain" } })).toBe(
      "IA : 1 acquise · 1 non acquise · 1 incertain"
    );
  });
});

describe("simulation", () => {
  it("produit une proposition valide, étiquetée démonstration", () => {
    const json = extraireJson(simulerPrecorrection("Réponse courte.", "décision ; trace"));
    const v = validerPrecorrection(json);
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.proposition.verdict).toBe("non_acquise");
    expect(v.proposition.criteres.map((c) => c.critere)).toEqual(["décision", "trace"]);
    expect(v.proposition.feedback_apprenant).toContain("[DÉMO]");
    const longue = validerPrecorrection(extraireJson(simulerPrecorrection("x".repeat(250), "")));
    expect(longue.ok && longue.proposition.verdict).toBe("acquise");
  });
});

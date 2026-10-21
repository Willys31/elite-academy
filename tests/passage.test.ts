import { describe, expect, it } from "vitest";
import {
  CONTEXTE_RAYON,
  CONTEXTE_SANS_PASSAGE,
  extraireContexte,
  nettoyerPassage,
  PASSAGE_MAX,
  passageValide,
} from "@/lib/tutorat/passage";

/* ------------------------------------------------------------------
   Lot 28 – « Expliquer ce passage » : nettoyage, validation, contexte
   ------------------------------------------------------------------ */

describe("nettoyerPassage", () => {
  it("normalise les espaces et retire guillemets et ponctuation de bord", () => {
    expect(nettoyerPassage("  marge   brute ")).toBe("marge brute");
    expect(nettoyerPassage("« marge brute »")).toBe("marge brute");
    expect(nettoyerPassage("“taux de rotation”.")).toBe("taux de rotation");
    expect(nettoyerPassage("(le besoin en fonds de roulement),")).toBe("le besoin en fonds de roulement");
    expect(nettoyerPassage(42)).toBe("");
  });

  it("garde la ponctuation intérieure", () => {
    expect(nettoyerPassage("l'écoute active : reformuler, puis valider")).toBe("l'écoute active : reformuler, puis valider");
  });
});

describe("passageValide", () => {
  it("refuse trop court, trop long, ou sans lettre", () => {
    expect(passageValide("a").ok).toBe(false);
    expect(passageValide("x".repeat(PASSAGE_MAX + 1)).ok).toBe(false);
    expect(passageValide("— —").ok).toBe(false);
    expect(passageValide("ok").ok).toBe(true);
    expect(passageValide("5S").ok).toBe(true);
  });

  it("explique le refus en français", () => {
    const r = passageValide("x".repeat(400));
    expect(r.ok === false && r.erreur).toContain("300");
  });
});

describe("extraireContexte", () => {
  const lecon =
    "Introduction à la gestion. " +
    "La marge brute est la différence entre le chiffre d'affaires et le coût d'achat des marchandises vendues. " +
    "Elle se mesure en valeur et en pourcentage. " +
    "Le besoin en fonds de roulement, lui, mesure le décalage de trésorerie.";

  it("trouve le passage malgré la casse, les accents et les espaces", () => {
    const r = extraireContexte(lecon, "MARGE  BRUTE");
    expect(r.trouve).toBe(true);
    expect(r.extrait).toContain("marge brute");
    expect(extraireContexte(lecon, "chiffre d'affaires").trouve).toBe(true);
    expect(extraireContexte(lecon, "tresorerie").trouve).toBe(true);
    expect(extraireContexte(lecon, "« marge brute »").trouve).toBe(true);
  });

  it("renvoie une fenêtre autour du passage, élargie au mot entier, avec des points de suspension", () => {
    const avant = "mot ".repeat(400); // 1 600 caractères
    const apres = " fin".repeat(400);
    const texte = `${avant}PIVOT central${apres}`;
    const r = extraireContexte(texte, "PIVOT central");
    expect(r.trouve).toBe(true);
    expect(r.extrait.startsWith("…")).toBe(true);
    expect(r.extrait.endsWith("…")).toBe(true);
    expect(r.extrait).toContain("PIVOT central");
    // ≈ 600 de chaque côté, plus l'élargissement au mot.
    expect(r.extrait.length).toBeLessThan(2 * CONTEXTE_RAYON + 40);
    expect(r.extrait.length).toBeGreaterThan(2 * CONTEXTE_RAYON - 40);
    expect(r.extrait).not.toMatch(/…mo /); // pas de mot coupé après l'ellipse
  });

  it("couvre le début et la fin du texte sans ellipse superflue", () => {
    const debut = extraireContexte(lecon, "Introduction");
    expect(debut.extrait.startsWith("…")).toBe(false);
    const fin = extraireContexte(lecon, "trésorerie");
    expect(fin.extrait.endsWith("…")).toBe(false);
    expect(fin.extrait.endsWith("trésorerie.")).toBe(true);
  });

  it("renvoie le début de la leçon quand le passage n'y figure pas", () => {
    const r = extraireContexte(lecon, "amortissement dégressif");
    expect(r.trouve).toBe(false);
    expect(r.extrait.startsWith("Introduction")).toBe(true);
    const long = extraireContexte("a".repeat(3000), "zzz");
    expect(long.extrait.length).toBe(CONTEXTE_SANS_PASSAGE + 1);
    expect(long.extrait.endsWith("…")).toBe(true);
  });

  it("ne plante pas sur une leçon vide ou un passage vide", () => {
    expect(extraireContexte("", "marge")).toEqual({ trouve: false, extrait: "" });
    expect(extraireContexte(lecon, "").trouve).toBe(false);
  });
});

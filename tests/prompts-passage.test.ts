import { describe, expect, it } from "vitest";
import {
  construirePromptPassage,
  LONGUEUR_MAX_EXPLICATION,
  PROMPT_VERSION_PASSAGE,
  SYSTEM_TUTEUR_PASSAGE,
} from "@/lib/ai/prompts-passage";
import { simulerExplicationPassage } from "@/lib/ai/simulation";

/* ------------------------------------------------------------------
   Lot 28 – prompt « Expliquer ce passage » et simulation
   ------------------------------------------------------------------ */

describe("prompt tuteur-passage", () => {
  it("porte une version, borne la longueur et interdit de répondre aux questions", () => {
    expect(PROMPT_VERSION_PASSAGE).toBe("tuteur-passage/v1");
    expect(SYSTEM_TUTEUR_PASSAGE).toContain(String(LONGUEUR_MAX_EXPLICATION));
    expect(SYSTEM_TUTEUR_PASSAGE).toContain("ne donne JAMAIS la réponse");
    expect(SYSTEM_TUTEUR_PASSAGE).toContain("DANS LE SENS QUE LUI DONNE LA LEÇON");
    expect(SYSTEM_TUTEUR_PASSAGE).toMatch(/ni le fait que tu es une IA/);
  });

  it("transmet formation, leçon, passage et extrait, sans identité", () => {
    const p = construirePromptPassage({
      formation: "Gestion d'un point de vente",
      secteur: "commerce",
      lecon: "Lire un compte de résultat",
      passage: "marge brute",
      extrait: "…La marge brute est la différence entre…",
      trouve: true,
    });
    expect(p).toContain("Formation : Gestion d'un point de vente (secteur : commerce)");
    expect(p).toContain("Leçon : Lire un compte de résultat");
    expect(p).toContain("PASSAGE À EXPLIQUER : « marge brute »");
    expect(p).toContain("figure dans l'extrait");
    expect(p).toContain("La marge brute est la différence");
    expect(p).not.toMatch(/apprenant\s*:|e-mail|@/i);
  });

  it("signale un passage absent et une leçon sans texte", () => {
    const absent = construirePromptPassage({ formation: "F", secteur: null, lecon: "L", passage: "amortissement", extrait: "Début…", trouve: false });
    expect(absent).toContain("ne figure pas dans l'extrait");
    expect(absent).not.toContain("secteur :");
    const vide = construirePromptPassage({ formation: "F", secteur: null, lecon: "L", passage: "x y", extrait: "", trouve: false });
    expect(vide).toContain("n'a pas de texte rédigé");
  });
});

describe("simulation", () => {
  it("produit une explication étiquetée DÉMO, selon que le passage est trouvé ou non", () => {
    const t = simulerExplicationPassage("marge brute", "Compte de résultat", true);
    expect(t).toContain("[DÉMO");
    expect(t).toContain("« marge brute »");
    expect(t).toContain("Compte de résultat");
    expect(simulerExplicationPassage("zzz", "L", false)).toContain("n'apparaît pas tel quel");
  });
});

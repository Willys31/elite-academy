import { describe, expect, it } from "vitest";
import {
  construirePromptReparation,
  genererAvecReparation,
  messageEchecControle,
  type ReponseJsonMinimale,
  type Verification,
} from "@/lib/ai/reparation";
import type { Probleme } from "@/lib/ai/controle-pedagogique";

/* ------------------------------------------------------------------
   Lot 25 – relance de réparation (appel simulé)
   ------------------------------------------------------------------ */

const ERREUR: Probleme = {
  code: "ACTIVITE_SANS_COMPETENCE",
  chemin: "modules[0].lessons[0].activities[0]",
  message: "modules[0].lessons[0].activities[0] ne référence aucune compétence existante.",
};

function reponse(json: unknown, jetons: [number, number] = [100, 50], tentatives = 1): ReponseJsonMinimale {
  return { json, modele: "deepseek-flash", fournisseur: "deepseek", inputTokens: jetons[0], outputTokens: jetons[1], tentatives };
}

/** Vérificateur : ok si `json.ok === true`. */
const verifier = (json: unknown): Verification<{ ok: boolean }> => {
  const o = json as { ok?: boolean } | null;
  if (o && o.ok === true) return { ok: true, valeur: o as { ok: boolean }, avertissements: [] };
  return { ok: false, erreurs: [ERREUR], avertissements: [] };
};

function fauxModele(reponses: ReponseJsonMinimale[]) {
  const prompts: string[] = [];
  const appeler = async (prompt: string) => {
    prompts.push(prompt);
    return reponses[Math.min(prompts.length - 1, reponses.length - 1)];
  };
  return { prompts, appeler };
}

describe("genererAvecReparation", () => {
  it("n'appelle qu'une fois quand le premier résultat passe le contrôle", async () => {
    const { prompts, appeler } = fauxModele([reponse({ ok: true })]);
    const r = await genererAvecReparation(appeler, "PROMPT", verifier);
    expect(prompts).toEqual(["PROMPT"]);
    expect(r.ok).toBe(true);
    expect(r.bilan.reparee).toBe(false);
    expect(r.bilan.appels).toBe(1);
    expect(r.bilan.inputTokens).toBe(100);
  });

  it("relance UNE fois avec la liste exacte des erreurs et additionne les jetons", async () => {
    const { prompts, appeler } = fauxModele([reponse({ ok: false, a: 1 }, [100, 50]), reponse({ ok: true }, [300, 70], 2)]);
    const r = await genererAvecReparation(appeler, "PROMPT", verifier);
    expect(prompts).toHaveLength(2);
    expect(prompts[1]).toContain("PROMPT");
    expect(prompts[1]).toContain("RÉPARATION DEMANDÉE");
    expect(prompts[1]).toContain("[ACTIVITE_SANS_COMPETENCE]");
    expect(prompts[1]).toContain(ERREUR.message);
    expect(prompts[1]).toContain('{"ok":false,"a":1}');
    expect(r.ok).toBe(true);
    expect(r.bilan).toMatchObject({ reparee: true, appels: 3, inputTokens: 400, outputTokens: 120 });
    expect(r.bilan.erreursInitiales).toEqual([ERREUR]);
  });

  it("échoue clairement au second échec, sans troisième appel", async () => {
    const { prompts, appeler } = fauxModele([reponse({ ok: false }), reponse({ ok: false })]);
    const r = await genererAvecReparation(appeler, "PROMPT", verifier);
    expect(prompts).toHaveLength(2);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.erreur).toContain("après une relance de réparation");
    expect(r.erreur).toContain("rien n'a été enregistré");
    expect(r.erreur).toContain(ERREUR.message);
    expect(r.bilan.reparee).toBe(true);
  });

  it("ne tente pas de réparer une réponse sans JSON exploitable", async () => {
    const { prompts, appeler } = fauxModele([reponse(null)]);
    const r = await genererAvecReparation(appeler, "PROMPT", verifier);
    expect(prompts).toHaveLength(1);
    expect(r.ok).toBe(false);
  });

  it("peut être appelée sans réparation (banc d'essai)", async () => {
    const { prompts, appeler } = fauxModele([reponse({ ok: false })]);
    const r = await genererAvecReparation(appeler, "PROMPT", verifier, { reparer: false });
    expect(prompts).toHaveLength(1);
    expect(r.ok).toBe(false);
  });

  it("additionne correctement des jetons absents", async () => {
    const { appeler } = fauxModele([
      { ...reponse({ ok: false }), inputTokens: null, outputTokens: null },
      { ...reponse({ ok: true }), inputTokens: 10, outputTokens: null },
    ]);
    const r = await genererAvecReparation(appeler, "P", verifier);
    expect(r.bilan.inputTokens).toBe(10);
    expect(r.bilan.outputTokens).toBeNull();
  });
});

describe("messages", () => {
  it("construirePromptReparation numérote les erreurs", () => {
    const p = construirePromptReparation("P", { x: 1 }, [ERREUR, { ...ERREUR, code: "QUIZ_SANS_QUESTION", message: "quiz vide" }]);
    expect(p).toContain("1. [ACTIVITE_SANS_COMPETENCE]");
    expect(p).toContain("2. [QUIZ_SANS_QUESTION] quiz vide");
    expect(p).toContain("JSON COMPLET corrigé");
  });

  it("messageEchecControle limite la liste à six erreurs", () => {
    const beaucoup = Array.from({ length: 9 }, (_, i) => ({ ...ERREUR, message: `erreur ${i}` }));
    const m = messageEchecControle(beaucoup, false);
    expect(m).toContain("erreur 5");
    expect(m).not.toContain("erreur 6");
    expect(m).toContain("3 autre(s)");
  });
});

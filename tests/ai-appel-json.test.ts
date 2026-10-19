import { describe, expect, it } from "vitest";
import {
  appelerJsonAvecRelances,
  messageTronque,
  type AppelBrut,
  type ContexteRelance,
  type OptionsRelance,
} from "@/lib/ai/appel-json";
import type { ReponseLlm } from "@/lib/ai/openai-compatible";

/* ------------------------------------------------------------------
   Lot 25 – relances de l'appel JSON (troncature, consigne renforcée)
   ------------------------------------------------------------------ */

const DEEPSEEK: ContexteRelance = { libelle: "DeepSeek", maxTokens: 65536, reflexionPriseEnCharge: true, reflexion: null };
const GEMINI: ContexteRelance = { libelle: "Gemini", maxTokens: 16000, reflexionPriseEnCharge: false, reflexion: null };

function reponse(texte: string, tronquee = false, jetons: [number, number] = [100, 200]): ReponseLlm {
  return { texte, modele: "m", fournisseur: "deepseek", inputTokens: jetons[0], outputTokens: jetons[1], tronquee };
}

function fauxModele(reponses: ReponseLlm[]) {
  const appels: Array<{ prompt: string; options: OptionsRelance }> = [];
  const appeler: AppelBrut = async (prompt, options) => {
    appels.push({ prompt, options });
    return reponses[Math.min(appels.length - 1, reponses.length - 1)];
  };
  return { appels, appeler };
}

describe("appelerJsonAvecRelances", () => {
  it("un seul appel quand la réponse est complète et JSON", async () => {
    const { appels, appeler } = fauxModele([reponse('{"a":1}')]);
    const r = await appelerJsonAvecRelances(appeler, "P", DEEPSEEK);
    expect(appels).toHaveLength(1);
    expect(appels[0].options).toEqual({});
    expect(r.json).toEqual({ a: 1 });
    expect(r.tentatives).toBe(1);
    expect(r.reflexionCoupee).toBe(false);
  });

  it("réponse tronquée chez DeepSeek : rejoue une fois sans réflexion et additionne les jetons", async () => {
    const { appels, appeler } = fauxModele([reponse('{"course": {"title": "x"', true, [100, 32768]), reponse('{"ok":true}', false, [100, 20000])]);
    const journal: string[] = [];
    const r = await appelerJsonAvecRelances(appeler, "P", DEEPSEEK, (m) => journal.push(m));
    expect(appels).toHaveLength(2);
    expect(appels[1].options).toEqual({ reflexion: "off" });
    expect(appels[1].prompt).toBe("P");
    expect(r.json).toEqual({ ok: true });
    expect(r.tentatives).toBe(2);
    expect(r.reflexionCoupee).toBe(true);
    expect(r.outputTokens).toBe(52768);
    expect(journal.join("\n")).toContain("relance sans réflexion");
  });

  it("encore tronquée après la relance : erreur claire, jamais de JSON partiel", async () => {
    const { appels, appeler } = fauxModele([reponse('{"course": {"title": "x"', true), reponse('{"course": {"ti', true)]);
    await expect(appelerJsonAvecRelances(appeler, "P", DEEPSEEK)).rejects.toThrow("LLM_MAX_TOKENS");
    expect(appels).toHaveLength(2);
  });

  it("tronquée chez un fournisseur sans réflexion : erreur immédiate avec le plafond", async () => {
    const { appels, appeler } = fauxModele([reponse('{"course"', true)]);
    await expect(appelerJsonAvecRelances(appeler, "P", GEMINI)).rejects.toThrow("16000 jetons");
    expect(appels).toHaveLength(1);
  });

  it("tronquée alors que la réflexion est déjà coupée : pas de relance inutile", async () => {
    const { appels, appeler } = fauxModele([reponse("{", true)]);
    await expect(appelerJsonAvecRelances(appeler, "P", { ...DEEPSEEK, reflexion: "off" })).rejects.toThrow("LLM_MAX_TOKENS");
    expect(appels).toHaveLength(1);
  });

  it("réponse complète sans JSON : une relance avec consigne renforcée", async () => {
    const { appels, appeler } = fauxModele([reponse("Voici le plan : ..."), reponse('{"b":2}')]);
    const r = await appelerJsonAvecRelances(appeler, "P", DEEPSEEK);
    expect(appels).toHaveLength(2);
    expect(appels[1].prompt).toContain("RAPPEL IMPORTANT");
    expect(appels[1].options).toEqual({});
    expect(r.json).toEqual({ b: 2 });
    expect(r.tentatives).toBe(2);
  });

  it("garde la réflexion coupée pour la relance JSON qui suit une troncature", async () => {
    const { appels, appeler } = fauxModele([reponse("{", true), reponse("pas du json"), reponse('{"c":3}')]);
    const r = await appelerJsonAvecRelances(appeler, "P", DEEPSEEK);
    expect(appels).toHaveLength(3);
    expect(appels[2].options).toEqual({ reflexion: "off" });
    expect(r.json).toEqual({ c: 3 });
    expect(r.tentatives).toBe(3);
  });

  it("renvoie json null si la relance JSON ne donne toujours rien", async () => {
    const { appeler } = fauxModele([reponse("rien"), reponse("toujours rien")]);
    const r = await appelerJsonAvecRelances(appeler, "P", DEEPSEEK);
    expect(r.json).toBeNull();
    expect(r.tentatives).toBe(2);
  });
});

describe("messageTronque", () => {
  it("propose de couper la réflexion seulement quand c'est possible", () => {
    expect(messageTronque(DEEPSEEK, false)).toContain("LLM_THINKING=off");
    expect(messageTronque(DEEPSEEK, true)).not.toContain("LLM_THINKING=off");
    expect(messageTronque(GEMINI, false)).not.toContain("LLM_THINKING");
    expect(messageTronque(GEMINI, false)).toContain("16000");
  });
});

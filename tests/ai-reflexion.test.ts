import { describe, expect, it } from "vitest";
import { resoudreConfiguration, type ConfigurationIa, type TacheIa } from "@/lib/ai/fournisseurs";
import { appelerChatCompletions, construireCorps, type FetchLike } from "@/lib/ai/openai-compatible";

/* ------------------------------------------------------------------
   Lot 25 – paramètre `thinking` et anciens noms DeepSeek côté appel
   ------------------------------------------------------------------ */

function config(valeurs: Record<string, string>, tache: TacheIa = "conception"): ConfigurationIa {
  const r = resoudreConfiguration((n) => valeurs[n] ?? "", tache);
  if (!r.ok) throw new Error(r.erreur);
  return r.config;
}

interface Appel {
  corps: Record<string, unknown>;
}

function fauxServeur(reponses: Array<{ status: number; body: unknown }>) {
  const appels: Appel[] = [];
  const fetchImpl: FetchLike = async (_url, init) => {
    appels.push({ corps: JSON.parse(init.body) as Record<string, unknown> });
    const r = reponses[Math.min(appels.length - 1, reponses.length - 1)];
    const body = typeof r.body === "string" ? r.body : JSON.stringify(r.body);
    return { ok: r.status >= 200 && r.status < 300, status: r.status, text: async () => body };
  };
  return { appels, fetchImpl };
}

const DS = { LLM_PROVIDER: "deepseek", LLM_API_KEY: "sk" };

describe("lot 25 – paramètre thinking", () => {
  it("désactive la réflexion pour une tâche d'interaction en auto", () => {
    const corps = construireCorps(config(DS, "tuteur"), { system: "S", prompt: "P" }, { avecJson: false });
    expect(corps.thinking).toEqual({ type: "disabled" });
    expect(corps.model).toBe("deepseek-flash");
  });

  it("n'envoie rien pour la conception en auto (choix laissé au modèle)", () => {
    const corps = construireCorps(config(DS, "conception"), { system: "S", prompt: "P" }, { avecJson: true });
    expect(corps.thinking).toBeUndefined();
    expect(corps.response_format).toEqual({ type: "json_object" });
  });

  it("LLM_THINKING=on active la réflexion, LLM_THINKING=off la coupe partout", () => {
    const on = construireCorps(config({ ...DS, LLM_THINKING: "on" }, "conception"), { system: "S", prompt: "P" }, { avecJson: false });
    expect(on.thinking).toEqual({ type: "enabled" });
    const off = construireCorps(config({ ...DS, LLM_THINKING: "off" }, "conception"), { system: "S", prompt: "P" }, { avecJson: false });
    expect(off.thinking).toEqual({ type: "disabled" });
  });

  it("n'envoie jamais thinking à un fournisseur qui ne le comprend pas", () => {
    const corps = construireCorps(
      config({ LLM_PROVIDER: "gemini", LLM_API_KEY: "k", LLM_THINKING: "on" }, "tuteur"),
      { system: "S", prompt: "P" },
      { avecJson: false }
    );
    expect(corps.thinking).toBeUndefined();
  });

  it("ignore reasoning_content et ne renvoie que le contenu final", async () => {
    const { appels, fetchImpl } = fauxServeur([
      {
        status: 200,
        body: {
          model: "deepseek-flash",
          choices: [
            {
              message: { role: "assistant", reasoning_content: "raisonnement interne", content: '{"a":1}' },
              finish_reason: "stop",
            },
          ],
          usage: { prompt_tokens: 3, completion_tokens: 9, completion_tokens_details: { reasoning_tokens: 7 } },
        },
      },
    ]);
    const r = await appelerChatCompletions(config(DS, "conception"), { system: "S", prompt: "P", json: true }, fetchImpl);
    expect(appels).toHaveLength(1);
    expect(r.texte).toBe('{"a":1}');
    expect(r.texte).not.toContain("raisonnement");
    expect(r.fournisseur).toBe("deepseek");
    expect(r.outputTokens).toBe(9);
    expect(r.tronquee).toBe(false);
  });

  it("journalise une troncature en mentionnant les jetons de réflexion", async () => {
    const { fetchImpl } = fauxServeur([
      {
        status: 200,
        body: {
          model: "deepseek-flash",
          choices: [{ message: { role: "assistant", content: "" }, finish_reason: "length" }],
          usage: { prompt_tokens: 3, completion_tokens: 32768, completion_tokens_details: { reasoning_tokens: 32768 } },
        },
      },
    ]);
    const journal: string[] = [];
    const r = await appelerChatCompletions(config(DS, "conception"), { system: "S", prompt: "P" }, fetchImpl, (m) => journal.push(m));
    expect(r.tronquee).toBe(true);
    expect(journal.join("\n")).toContain("tronquée");
    expect(journal.join("\n")).toContain("réflexion");
  });
});

describe("lot 25 – anciens noms DeepSeek", () => {
  it("explique le retrait de deepseek-chat sur un 400 « Model Not Exist »", async () => {
    const { fetchImpl } = fauxServeur([{ status: 400, body: { error: { message: "Model Not Exist" } } }]);
    await expect(
      appelerChatCompletions(config({ ...DS, LLM_MODEL: "deepseek-chat" }), { system: "S", prompt: "P" }, fetchImpl)
    ).rejects.toThrow("retiré par DeepSeek le 24 juillet 2026");
  });

  it("idem pour deepseek-reasoner sur un 404, avec le remplaçant", async () => {
    const { fetchImpl } = fauxServeur([{ status: 404, body: "" }]);
    await expect(
      appelerChatCompletions(config({ ...DS, LLM_MODEL: "deepseek-reasoner" }), { system: "S", prompt: "P" }, fetchImpl)
    ).rejects.toThrow("deepseek-v4-pro");
  });

  it("un vrai modèle inconnu garde le message « introuvable »", async () => {
    const { fetchImpl } = fauxServeur([{ status: 404, body: "" }]);
    await expect(
      appelerChatCompletions(config({ ...DS, LLM_MODEL: "deepseek-v9" }), { system: "S", prompt: "P" }, fetchImpl)
    ).rejects.toThrow("introuvable");
  });
});

import { describe, expect, it } from "vitest";
import { resoudreConfiguration, type ConfigurationIa } from "@/lib/ai/fournisseurs";
import {
  appelerChatCompletions,
  construireCorps,
  erreurHttp,
  erreurReseau,
  messageDuCorps,
  texteDuChoix,
  type FetchLike,
} from "@/lib/ai/openai-compatible";

function configDeepSeek(extra: Record<string, string> = {}): ConfigurationIa {
  const r = resoudreConfiguration((n) => ({ LLM_PROVIDER: "deepseek", LLM_API_KEY: "sk-test", ...extra })[n] ?? "");
  if (!r.ok) throw new Error(r.erreur);
  return r.config;
}

function configOllama(extra: Record<string, string> = {}): ConfigurationIa {
  const r = resoudreConfiguration((n) => ({ LLM_PROVIDER: "ollama", ...extra })[n] ?? "");
  if (!r.ok) throw new Error(r.erreur);
  return r.config;
}

interface Appel {
  url: string;
  headers: Record<string, string>;
  corps: Record<string, unknown>;
}

/** Faux serveur : enregistre les appels et rejoue les réponses données. */
function fauxServeur(reponses: Array<{ status: number; body: unknown }>) {
  const appels: Appel[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    appels.push({ url, headers: init.headers, corps: JSON.parse(init.body) as Record<string, unknown> });
    const r = reponses[Math.min(appels.length - 1, reponses.length - 1)];
    const body = typeof r.body === "string" ? r.body : JSON.stringify(r.body);
    return { ok: r.status >= 200 && r.status < 300, status: r.status, text: async () => body };
  };
  return { appels, fetchImpl };
}

const REPONSE_OK = {
  id: "x",
  model: "deepseek-flash",
  choices: [{ message: { role: "assistant", content: '{"ok": true}' }, finish_reason: "stop" }],
  usage: { prompt_tokens: 12, completion_tokens: 5 },
};

describe("construireCorps", () => {
  it("envoie system + user, le modèle, le plafond et le mode JSON", () => {
    const corps = construireCorps(configDeepSeek(), { system: "S", prompt: "P" }, { avecJson: true });
    expect(corps).toEqual({
      model: "deepseek-flash",
      max_tokens: 65536,
      messages: [
        { role: "system", content: "S" },
        { role: "user", content: "P" },
      ],
      response_format: { type: "json_object" },
    });
  });

  it("omet response_format et temperature quand ils ne sont pas demandés", () => {
    const corps = construireCorps(configDeepSeek(), { system: "S", prompt: "P" }, { avecJson: false });
    expect(corps.response_format).toBeUndefined();
    expect(corps.temperature).toBeUndefined();
    expect(construireCorps(configDeepSeek({ LLM_TEMPERATURE: "0.2" }), { system: "S", prompt: "P" }, { avecJson: false }).temperature).toBe(0.2);
  });
});

describe("appelerChatCompletions", () => {
  it("appelle DeepSeek avec la clé et lit texte, modèle et jetons", async () => {
    const { appels, fetchImpl } = fauxServeur([{ status: 200, body: REPONSE_OK }]);
    const r = await appelerChatCompletions(configDeepSeek(), { system: "S", prompt: "P", json: true }, fetchImpl);
    expect(appels).toHaveLength(1);
    expect(appels[0].url).toBe("https://api.deepseek.com/v1/chat/completions");
    expect(appels[0].headers.authorization).toBe("Bearer sk-test");
    expect(appels[0].corps.response_format).toEqual({ type: "json_object" });
    expect(r).toEqual({ texte: '{"ok": true}', modele: "deepseek-flash", fournisseur: "deepseek", inputTokens: 12, outputTokens: 5, tronquee: false });
  });

  it("rejoue sans response_format quand le serveur refuse le mode JSON", async () => {
    const { appels, fetchImpl } = fauxServeur([
      { status: 400, body: { error: { message: "response_format is not supported by this model" } } },
      { status: 200, body: REPONSE_OK },
    ]);
    const r = await appelerChatCompletions(configOllama(), { system: "S", prompt: "P", json: true }, fetchImpl);
    expect(appels).toHaveLength(2);
    expect(appels[0].corps.response_format).toBeDefined();
    expect(appels[1].corps.response_format).toBeUndefined();
    expect(r.texte).toBe('{"ok": true}');
  });

  it("n'envoie pas response_format quand le mode JSON est désactivé", async () => {
    const { appels, fetchImpl } = fauxServeur([{ status: 200, body: REPONSE_OK }]);
    await appelerChatCompletions(configDeepSeek({ LLM_JSON_MODE: "off" }), { system: "S", prompt: "P", json: true }, fetchImpl);
    expect(appels[0].corps.response_format).toBeUndefined();
  });

  it("envoie un jeton factice à un serveur local sans clé", async () => {
    const { appels, fetchImpl } = fauxServeur([{ status: 200, body: REPONSE_OK }]);
    await appelerChatCompletions(configOllama(), { system: "S", prompt: "P" }, fetchImpl);
    expect(appels[0].url).toBe("http://localhost:11434/v1/chat/completions");
    expect(appels[0].headers.authorization).toBe("Bearer sans-cle");
  });

  it("traduit les erreurs HTTP en messages explicites", async () => {
    const cas: Array<[number, unknown, string]> = [
      [401, { error: { message: "Authentication Fails" } }, "clé API DeepSeek est invalide"],
      [402, { error: { message: "Insufficient Balance" } }, "Solde insuffisant"],
      [404, { error: { message: "Model Not Exist" } }, "deepseek-flash » introuvable"],
      [429, "", "Limite d'utilisation de DeepSeek"],
      [400, { error: { message: "invalid max_tokens" } }, "invalid max_tokens"],
      [503, "", "indisponible"],
    ];
    for (const [status, body, attendu] of cas) {
      const { fetchImpl } = fauxServeur([{ status, body }]);
      await expect(
        appelerChatCompletions(configDeepSeek(), { system: "S", prompt: "P" }, fetchImpl)
      ).rejects.toThrow(attendu);
    }
  });

  it("conseille « ollama pull » quand le modèle local manque", async () => {
    const { fetchImpl } = fauxServeur([{ status: 404, body: { error: { message: "model not found" } } }]);
    await expect(
      appelerChatCompletions(configOllama({ LLM_MODEL: "llama3.1" }), { system: "S", prompt: "P" }, fetchImpl)
    ).rejects.toThrow("ollama pull llama3.1");
  });

  it("explique une réponse qui n'est pas du JSON (mauvaise URL de base)", async () => {
    const { fetchImpl } = fauxServeur([{ status: 200, body: "<html>Ollama is running</html>" }]);
    await expect(
      appelerChatCompletions(configOllama(), { system: "S", prompt: "P" }, fetchImpl)
    ).rejects.toThrow("LLM_BASE_URL");
  });

  it("signale un serveur local injoignable", async () => {
    const fetchImpl: FetchLike = async () => {
      throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } });
    };
    await expect(
      appelerChatCompletions(configOllama(), { system: "S", prompt: "P" }, fetchImpl)
    ).rejects.toThrow("Le serveur local est-il démarré");
  });

  it("lit un contenu en blocs (certains serveurs locaux)", () => {
    expect(texteDuChoix({ choices: [{ message: { content: [{ type: "text", text: "a" }, { type: "text", text: "b" }] } }] })).toBe("a\nb");
    expect(texteDuChoix({ choices: [] })).toBe("");
  });
});

describe("messages d'erreur", () => {
  it("messageDuCorps lit les formats error.message, error et message", () => {
    expect(messageDuCorps('{"error": {"message": "x"}}')).toBe("x");
    expect(messageDuCorps('{"error": "y"}')).toBe("y");
    expect(messageDuCorps('{"message": "z"}')).toBe("z");
    expect(messageDuCorps("texte   brut\n")).toBe("texte brut");
  });

  it("erreurHttp garde l'aide Gemini pour une clé Vertex", () => {
    const r = resoudreConfiguration((n) => ({ LLM_PROVIDER: "gemini", LLM_API_KEY: "AQ.abc" })[n] ?? "");
    if (!r.ok) throw new Error(r.erreur);
    expect(erreurHttp(400, r.config, "Please pass a valid API key").message).toContain("Vertex AI");
  });

  it("erreurReseau explique un délai dépassé", () => {
    const e = Object.assign(new Error("t"), { name: "TimeoutError" });
    expect(erreurReseau(e, configOllama({ LLM_TIMEOUT_MS: "30000" })).message).toContain("30 s");
  });
});

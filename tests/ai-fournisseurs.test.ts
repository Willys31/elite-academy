import { describe, expect, it } from "vitest";
import {
  analyserFournisseur,
  decrireConfiguration,
  resoudreConfiguration,
  type LecteurEnv,
} from "@/lib/ai/fournisseurs";

const env = (valeurs: Record<string, string>): LecteurEnv => (nom) => valeurs[nom] ?? "";

function config(valeurs: Record<string, string>) {
  const r = resoudreConfiguration(env(valeurs));
  if (!r.ok) throw new Error(r.erreur);
  return r.config;
}

function erreur(valeurs: Record<string, string>) {
  const r = resoudreConfiguration(env(valeurs));
  if (r.ok) throw new Error("configuration acceptée à tort");
  return r.erreur;
}

describe("analyserFournisseur", () => {
  it("reconnaît les fournisseurs et leurs alias, sans tenir compte de la casse", () => {
    expect(analyserFournisseur("DeepSeek")).toBe("deepseek");
    expect(analyserFournisseur(" ollama ")).toBe("ollama");
    expect(analyserFournisseur("openai-compatible")).toBe("compatible");
    expect(analyserFournisseur("local")).toBe("compatible");
    expect(analyserFournisseur("claude")).toBe("anthropic");
  });

  it("renvoie null pour une valeur vide ou inconnue", () => {
    expect(analyserFournisseur("")).toBeNull();
    expect(analyserFournisseur("mistral-cloud")).toBeNull();
  });
});

describe("resoudreConfiguration – DeepSeek", () => {
  it("configure DeepSeek avec l'URL, le modèle et le plafond par défaut", () => {
    const c = config({ LLM_PROVIDER: "deepseek", LLM_API_KEY: "sk-test" });
    expect(c.fournisseur).toBe("deepseek");
    expect(c.baseUrl).toBe("https://api.deepseek.com/v1");
    expect(c.modele).toBe("deepseek-chat");
    expect(c.apiKey).toBe("sk-test");
    expect(c.modeJson).toBe("on");
    expect(c.maxTokens).toBe(8192);
  });

  it("refuse DeepSeek sans clé, avec un message qui dit où l'obtenir", () => {
    const e = erreur({ LLM_PROVIDER: "deepseek" });
    expect(e).toContain("LLM_API_KEY");
    expect(e).toContain("DeepSeek");
    expect(e).toContain("platform.deepseek.com");
  });

  it("laisse remplacer le modèle, l'URL de base et les plafonds", () => {
    const c = config({
      LLM_PROVIDER: "deepseek",
      LLM_API_KEY: "sk",
      LLM_MODEL: "deepseek-reasoner",
      LLM_BASE_URL: "https://proxy.interne/v1/",
      LLM_MAX_TOKENS: "4096",
      LLM_TIMEOUT_MS: "30000",
      LLM_TEMPERATURE: "0.3",
    });
    expect(c.modele).toBe("deepseek-reasoner");
    expect(c.baseUrl).toBe("https://proxy.interne/v1");
    expect(c.maxTokens).toBe(4096);
    expect(c.timeoutMs).toBe(30000);
    expect(c.temperature).toBe(0.3);
  });
});

describe("resoudreConfiguration – serveurs locaux", () => {
  it("accepte Ollama sans clé, sur localhost:11434", () => {
    const c = config({ LLM_PROVIDER: "ollama" });
    expect(c.baseUrl).toBe("http://localhost:11434/v1");
    expect(c.cleRequise).toBe(false);
    expect(c.apiKey).toBe("");
    expect(c.modele).toBe("deepseek-r1:8b");
  });

  it("accepte vLLM sans clé, sur localhost:8000", () => {
    const c = config({ LLM_PROVIDER: "vllm", LLM_MODEL: "deepseek-ai/DeepSeek-V3" });
    expect(c.baseUrl).toBe("http://localhost:8000/v1");
    expect(c.cleRequise).toBe(false);
  });

  it("exige LLM_BASE_URL et LLM_MODEL pour un serveur compatible générique", () => {
    expect(erreur({ LLM_PROVIDER: "compatible" })).toContain("LLM_BASE_URL");
    expect(
      erreur({ LLM_PROVIDER: "compatible", LLM_BASE_URL: "http://serveur:8080/v1" })
    ).toContain("LLM_MODEL");
    const c = config({
      LLM_PROVIDER: "compatible",
      LLM_BASE_URL: "http://serveur:8080/v1",
      LLM_MODEL: "mon-modele",
    });
    expect(c.modeJson).toBe("off");
  });

  it("tolère une URL collée avec /chat/completions ou une barre finale", () => {
    const c = config({
      LLM_PROVIDER: "ollama",
      LLM_BASE_URL: "http://192.168.1.10:11434/v1/chat/completions",
    });
    expect(c.baseUrl).toBe("http://192.168.1.10:11434/v1");
  });

  it("refuse une URL de base qui n'est pas http(s)", () => {
    expect(erreur({ LLM_PROVIDER: "ollama", LLM_BASE_URL: "localhost:11434" })).toContain(
      "LLM_BASE_URL invalide"
    );
  });
});

describe("resoudreConfiguration – compatibilité avec l'existant", () => {
  it("garde Anthropic par défaut et ses variables historiques", () => {
    const c = config({ ANTHROPIC_API_KEY: "sk-ant", ANTHROPIC_MODEL: "claude-opus-4" });
    expect(c.fournisseur).toBe("anthropic");
    expect(c.modele).toBe("claude-opus-4");
    expect(c.modeJson).toBe("off");
  });

  it("signale l'absence totale de configuration", () => {
    expect(erreur({})).toContain("ANTHROPIC_API_KEY");
    expect(erreur({})).toContain("deepseek");
  });

  it("garde Gemini, Groq et OpenRouter tels quels", () => {
    expect(config({ LLM_PROVIDER: "gemini", LLM_API_KEY: "AIza" }).baseUrl).toBe(
      "https://generativelanguage.googleapis.com/v1beta/openai"
    );
    expect(config({ LLM_PROVIDER: "groq", LLM_API_KEY: "g" }).modele).toBe("llama-3.3-70b-versatile");
    expect(config({ LLM_PROVIDER: "openrouter", LLM_API_KEY: "o" }).modeJson).toBe("off");
  });

  it("refuse un fournisseur inconnu avec la liste des valeurs acceptées", () => {
    const e = erreur({ LLM_PROVIDER: "mistral-cloud", LLM_API_KEY: "x" });
    expect(e).toContain("Fournisseur IA inconnu");
    expect(e).toContain("deepseek");
    expect(e).toContain("ollama");
  });

  it("permet de forcer ou d'interdire le mode JSON", () => {
    expect(config({ LLM_PROVIDER: "deepseek", LLM_API_KEY: "k", LLM_JSON_MODE: "off" }).modeJson).toBe("off");
    expect(
      config({
        LLM_PROVIDER: "compatible",
        LLM_BASE_URL: "http://s/v1",
        LLM_MODEL: "m",
        LLM_JSON_MODE: "on",
      }).modeJson
    ).toBe("on");
  });
});

describe("decrireConfiguration", () => {
  it("décrit le fournisseur sans révéler la clé", () => {
    const c = config({ LLM_PROVIDER: "deepseek", LLM_API_KEY: "sk-secret" });
    const d = decrireConfiguration(c);
    expect(d).toContain("DeepSeek");
    expect(d).toContain("deepseek-chat");
    expect(d).not.toContain("sk-secret");
  });
});

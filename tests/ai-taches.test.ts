import { describe, expect, it } from "vitest";
import {
  analyserModeReflexion,
  classeDeTache,
  messageModeleRetire,
  reflexionPour,
  resoudreConfiguration,
  TACHES_IA,
  type LecteurEnv,
  type TacheIa,
} from "@/lib/ai/fournisseurs";

/* ------------------------------------------------------------------
   Lot 25 – préréglage DeepSeek V4, tâches, routage, réflexion
   ------------------------------------------------------------------ */

const env = (valeurs: Record<string, string>): LecteurEnv => (nom) => valeurs[nom] ?? "";

function config(valeurs: Record<string, string>, tache: TacheIa = "conception") {
  const r = resoudreConfiguration(env(valeurs), tache);
  if (!r.ok) throw new Error(r.erreur);
  return r.config;
}

function erreur(valeurs: Record<string, string>, tache: TacheIa) {
  const r = resoudreConfiguration(env(valeurs), tache);
  if (r.ok) throw new Error("configuration acceptée à tort");
  return r.erreur;
}

describe("lot 25 – classes de tâches", () => {
  it("range conception et import en conception, le reste en interaction", () => {
    expect(classeDeTache("conception")).toBe("conception");
    expect(classeDeTache("import")).toBe("conception");
    expect(classeDeTache("tuteur")).toBe("interaction");
    expect(classeDeTache("exercices")).toBe("interaction");
    expect(classeDeTache("analyse_session")).toBe("interaction");
    expect(TACHES_IA).toHaveLength(5);
  });
});

describe("lot 25 – préréglage DeepSeek V4 (doc officielle du 16/10/2026)", () => {
  it("utilise deepseek-flash par défaut, avec un plafond cohérent avec la doc", () => {
    const c = config({ LLM_PROVIDER: "deepseek", LLM_API_KEY: "sk" });
    expect(c.modele).toBe("deepseek-flash");
    expect(c.maxTokens).toBe(32768);
    expect(c.maxTokens).toBeLessThanOrEqual(393216);
    expect(c.reflexionPriseEnCharge).toBe(true);
  });

  it("LLM_MAX_TOKENS remplace toujours le plafond", () => {
    expect(config({ LLM_PROVIDER: "deepseek", LLM_API_KEY: "sk", LLM_MAX_TOKENS: "65536" }).maxTokens).toBe(65536);
  });

  it("explique le retrait de deepseek-chat et deepseek-reasoner", () => {
    const m = messageModeleRetire("deepseek", "deepseek-chat");
    expect(m).toContain("retiré par DeepSeek");
    expect(m).toContain("24 juillet 2026");
    expect(m).toContain("deepseek-flash");
    expect(messageModeleRetire("deepseek", "deepseek-reasoner")).toContain("deepseek-v4-pro");
    expect(messageModeleRetire("deepseek", "deepseek-flash")).toBeNull();
    expect(messageModeleRetire("openai", "deepseek-chat")).toBeNull();
  });
});

describe("lot 25 – mode réflexion (LLM_THINKING)", () => {
  it("lit auto | on | off avec leurs synonymes", () => {
    expect(analyserModeReflexion("")).toBe("auto");
    expect(analyserModeReflexion("ON")).toBe("on");
    expect(analyserModeReflexion("enabled")).toBe("on");
    expect(analyserModeReflexion("off")).toBe("off");
    expect(analyserModeReflexion("none")).toBe("off");
    expect(analyserModeReflexion("valeur inconnue")).toBe("auto");
  });

  it("en auto : désactivée pour l'interaction, laissée au modèle pour la conception", () => {
    expect(reflexionPour("auto", "interaction", true)).toBe("off");
    expect(reflexionPour("auto", "conception", true)).toBeNull();
    expect(reflexionPour("on", "interaction", true)).toBe("on");
    expect(reflexionPour("off", "conception", true)).toBe("off");
  });

  it("n'est jamais transmise à un fournisseur qui ne la comprend pas", () => {
    expect(reflexionPour("on", "conception", false)).toBeNull();
    const c = config({ LLM_PROVIDER: "gemini", LLM_API_KEY: "k", LLM_THINKING: "on" }, "tuteur");
    expect(c.reflexion).toBeNull();
    expect(c.reflexionPriseEnCharge).toBe(false);
  });

  it("se résout par tâche pour DeepSeek", () => {
    const base = { LLM_PROVIDER: "deepseek", LLM_API_KEY: "sk" };
    expect(config(base, "tuteur").reflexion).toBe("off");
    expect(config(base, "analyse_session").reflexion).toBe("off");
    expect(config(base, "conception").reflexion).toBeNull();
    expect(config({ ...base, LLM_THINKING: "on" }, "exercices").reflexion).toBe("on");
    expect(config({ ...base, LLM_THINKING: "off" }, "conception").reflexion).toBe("off");
  });
});

describe("lot 25 – un modèle par tâche", () => {
  const base = { LLM_PROVIDER: "deepseek", LLM_API_KEY: "sk" };

  it("sans réglage : le modèle par défaut du préréglage pour toutes les tâches", () => {
    for (const t of TACHES_IA) expect(config(base, t).modele).toBe("deepseek-flash");
  });

  it("LLM_MODEL_CONCEPTION ne touche que conception et import", () => {
    const e = { ...base, LLM_MODEL_CONCEPTION: "deepseek-v4-pro" };
    expect(config(e, "conception").modele).toBe("deepseek-v4-pro");
    expect(config(e, "import").modele).toBe("deepseek-v4-pro");
    expect(config(e, "tuteur").modele).toBe("deepseek-flash");
    expect(config(e, "analyse_session").modele).toBe("deepseek-flash");
  });

  it("LLM_MODEL_INTERACTION ne touche que tuteur, exercices et analyse", () => {
    const e = { ...base, LLM_MODEL_INTERACTION: "deepseek-v4-pro" };
    expect(config(e, "conception").modele).toBe("deepseek-flash");
    expect(config(e, "exercices").modele).toBe("deepseek-v4-pro");
  });

  it("replis : par classe, puis LLM_MODEL, puis préréglage", () => {
    const e = { ...base, LLM_MODEL: "deepseek-v4-pro", LLM_MODEL_INTERACTION: "deepseek-flash" };
    expect(config(e, "conception").modele).toBe("deepseek-v4-pro");
    expect(config(e, "tuteur").modele).toBe("deepseek-flash");
    expect(config({ ...base, LLM_MODEL: "deepseek-v4-pro" }, "tuteur").modele).toBe("deepseek-v4-pro");
  });

  it("vaut aussi pour Anthropic", () => {
    const e = { ANTHROPIC_API_KEY: "sk-ant", LLM_MODEL_INTERACTION: "claude-haiku-4-5" };
    expect(config(e, "tuteur").modele).toBe("claude-haiku-4-5");
    expect(config(e, "conception").modele).toBe("claude-sonnet-4-5");
  });

  it("renseigne la tâche et la classe dans la configuration", () => {
    const c = config(base, "exercices");
    expect(c.tache).toBe("exercices");
    expect(c.classe).toBe("interaction");
    expect(c.fournisseurDedie).toBe(false);
  });
});

describe("lot 25 – fournisseur distinct pour l'interaction (hypothèse H5)", () => {
  const e = {
    LLM_PROVIDER: "deepseek",
    LLM_API_KEY: "sk-principal",
    LLM_MODEL_CONCEPTION: "deepseek-v4-pro",
    LLM_PROVIDER_INTERACTION: "vllm",
    LLM_BASE_URL_INTERACTION: "http://10.0.0.5:8000/v1",
    LLM_MODEL_INTERACTION: "deepseek-ai/DeepSeek-V3",
  };

  it("la conception reste sur le fournisseur principal", () => {
    const c = config(e, "conception");
    expect(c.fournisseur).toBe("deepseek");
    expect(c.apiKey).toBe("sk-principal");
    expect(c.modele).toBe("deepseek-v4-pro");
    expect(c.fournisseurDedie).toBe(false);
  });

  it("l'interaction part vers le fournisseur dédié, sans la clé du principal", () => {
    const c = config(e, "tuteur");
    expect(c.fournisseur).toBe("vllm");
    expect(c.baseUrl).toBe("http://10.0.0.5:8000/v1");
    expect(c.modele).toBe("deepseek-ai/DeepSeek-V3");
    expect(c.apiKey).toBe("");
    expect(c.fournisseurDedie).toBe(true);
    expect(c.reflexion).toBeNull();
  });

  it("un fournisseur dédié en ligne exige SA clé, nommée dans l'erreur", () => {
    expect(
      erreur({ LLM_PROVIDER: "deepseek", LLM_API_KEY: "sk", LLM_PROVIDER_INTERACTION: "openai" }, "exercices")
    ).toContain("LLM_API_KEY_INTERACTION");
  });

  it("le modèle générique LLM_MODEL ne fuit pas vers le fournisseur dédié", () => {
    const c = config(
      { LLM_PROVIDER: "deepseek", LLM_API_KEY: "sk", LLM_MODEL: "deepseek-v4-pro", LLM_PROVIDER_INTERACTION: "ollama" },
      "tuteur"
    );
    expect(c.fournisseur).toBe("ollama");
    expect(c.modele).toBe("deepseek-r1:8b");
  });

  it("un fournisseur dédié inconnu est refusé en nommant LLM_PROVIDER_INTERACTION", () => {
    expect(
      erreur({ LLM_PROVIDER: "deepseek", LLM_API_KEY: "sk", LLM_PROVIDER_INTERACTION: "mistral-cloud" }, "tuteur")
    ).toContain("LLM_PROVIDER_INTERACTION");
  });

  it("LLM_BASE_URL_INTERACTION manquante pour un serveur générique dédié est signalée", () => {
    expect(
      erreur({ LLM_PROVIDER: "deepseek", LLM_API_KEY: "sk", LLM_PROVIDER_INTERACTION: "compatible" }, "tuteur")
    ).toContain("LLM_BASE_URL_INTERACTION");
  });
});

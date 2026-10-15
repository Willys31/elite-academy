/**
 * Résolution de la configuration du fournisseur IA — logique pure,
 * testée unitairement. Ne lit pas `process.env` directement : elle
 * reçoit un lecteur de variables, ce qui permet de la tester et de la
 * garder indépendante de Next.
 *
 * Deux protocoles sont parlés par `client.ts` :
 * - l'API Anthropic (`anthropic`) ;
 * - le protocole « OpenAI compatible » (`/chat/completions`), commun à
 *   DeepSeek, OpenAI, Gemini (passerelle OpenAI), Groq, OpenRouter,
 *   Ollama, vLLM, LM Studio, LocalAI… et à tout serveur maison exposant
 *   la même route.
 *
 * Le fournisseur se choisit avec LLM_PROVIDER ; l'URL de base
 * (LLM_BASE_URL) et le modèle (LLM_MODEL) sont toujours remplaçables.
 * Un fournisseur local (Ollama, vLLM, `compatible`) n'exige pas de clé.
 */

export const FOURNISSEURS = [
  "anthropic",
  "gemini",
  "groq",
  "openrouter",
  "deepseek",
  "openai",
  "ollama",
  "vllm",
  "compatible",
] as const;
export type Fournisseur = (typeof FOURNISSEURS)[number];

/** Alias acceptés dans LLM_PROVIDER (insensible à la casse). */
const ALIAS: Record<string, Fournisseur> = {
  "openai-compatible": "compatible",
  openai_compatible: "compatible",
  local: "compatible",
  lmstudio: "compatible",
  localai: "compatible",
  claude: "anthropic",
  google: "gemini",
};

/** Fonctions aptes à produire du JSON : `response_format` accepté ou non. */
export type ModeJson = "auto" | "on" | "off";

export interface PresetFournisseur {
  libelle: string;
  /** URL de base (sans `/chat/completions`) ; vide = LLM_BASE_URL obligatoire. */
  baseUrl: string;
  modeleDefaut: string;
  /** Une clé est-elle indispensable ? (non pour un serveur local) */
  cleRequise: boolean;
  /** Le serveur accepte-t-il `response_format: {type: "json_object"}` ? */
  jsonMode: boolean;
  /** Plafond de jetons en sortie accepté par le service. */
  maxTokens: number;
  /** Où obtenir une clé ou installer le serveur (pour les messages). */
  aide: string;
}

export const PRESETS: Record<Exclude<Fournisseur, "anthropic">, PresetFournisseur> = {
  gemini: {
    libelle: "Gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    modeleDefaut: "gemini-2.5-flash",
    cleRequise: true,
    jsonMode: true,
    maxTokens: 16000,
    aide: "https://aistudio.google.com/apikey",
  },
  groq: {
    libelle: "Groq",
    baseUrl: "https://api.groq.com/openai/v1",
    modeleDefaut: "llama-3.3-70b-versatile",
    cleRequise: true,
    jsonMode: true,
    maxTokens: 16000,
    aide: "https://console.groq.com",
  },
  openrouter: {
    libelle: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    modeleDefaut: "meta-llama/llama-3.3-70b-instruct:free",
    cleRequise: true,
    // Dépend du modèle sous-jacent : on n'impose pas le mode JSON, le
    // repli textuel suffit.
    jsonMode: false,
    maxTokens: 16000,
    aide: "https://openrouter.ai/keys",
  },
  deepseek: {
    libelle: "DeepSeek",
    baseUrl: "https://api.deepseek.com/v1",
    modeleDefaut: "deepseek-chat",
    cleRequise: true,
    jsonMode: true,
    // deepseek-chat refuse toute valeur au-delà de 8 192 jetons en sortie.
    maxTokens: 8192,
    aide: "https://platform.deepseek.com/api_keys",
  },
  openai: {
    libelle: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    modeleDefaut: "gpt-4o-mini",
    cleRequise: true,
    jsonMode: true,
    maxTokens: 16000,
    aide: "https://platform.openai.com/api-keys",
  },
  ollama: {
    libelle: "Ollama",
    baseUrl: "http://localhost:11434/v1",
    modeleDefaut: "deepseek-r1:8b",
    cleRequise: false,
    jsonMode: true,
    maxTokens: 8192,
    aide: "https://ollama.com/download puis « ollama pull <modèle> »",
  },
  vllm: {
    libelle: "vLLM",
    baseUrl: "http://localhost:8000/v1",
    modeleDefaut: "deepseek-ai/DeepSeek-V3",
    cleRequise: false,
    jsonMode: true,
    maxTokens: 8192,
    aide: "https://docs.vllm.ai (serveur « vllm serve <modèle> »)",
  },
  compatible: {
    libelle: "Serveur compatible OpenAI",
    baseUrl: "",
    modeleDefaut: "",
    cleRequise: false,
    jsonMode: false,
    maxTokens: 8192,
    aide: "LLM_BASE_URL doit pointer vers la racine de l'API (ex. http://serveur:8080/v1)",
  },
};

/** Lecteur de variables d'environnement (valeur nettoyée, vide si absente). */
export type LecteurEnv = (nom: string) => string;

/** Transforme la valeur de LLM_PROVIDER en fournisseur connu, sinon null. */
export function analyserFournisseur(valeur: string): Fournisseur | null {
  const v = valeur.trim().toLowerCase();
  if (!v) return null;
  if ((FOURNISSEURS as readonly string[]).includes(v)) return v as Fournisseur;
  return ALIAS[v] ?? null;
}

export interface ConfigurationIa {
  fournisseur: Fournisseur;
  libelle: string;
  /** Vide pour Anthropic (URL fixe). */
  baseUrl: string;
  modele: string;
  apiKey: string;
  cleRequise: boolean;
  modeJson: ModeJson;
  maxTokens: number;
  timeoutMs: number;
  temperature: number | null;
  aide: string;
}

export type ResolutionIa =
  | { ok: true; config: ConfigurationIa }
  | { ok: false; erreur: string };

function normaliserBaseUrl(url: string): string {
  let u = url.trim().replace(/\/+$/, "");
  // Tolérance : l'utilisateur a collé l'URL complète de la route.
  u = u.replace(/\/chat\/completions$/i, "");
  return u;
}

function entierPositif(valeur: string, defaut: number): number {
  const n = Number.parseInt(valeur, 10);
  return Number.isFinite(n) && n > 0 ? n : defaut;
}

/**
 * Résout la configuration complète à partir des variables. Renvoie une
 * erreur EXPLICITE (en français, actionnable) plutôt qu'une
 * configuration bancale : fournisseur inconnu, clé absente, URL de base
 * manquante ou invalide pour un serveur local.
 */
export function resoudreConfiguration(env: LecteurEnv): ResolutionIa {
  const brut = env("LLM_PROVIDER");
  let fournisseur: Fournisseur;
  if (!brut) {
    fournisseur = "anthropic";
  } else {
    const f = analyserFournisseur(brut);
    if (!f) {
      return {
        ok: false,
        erreur:
          `Fournisseur IA inconnu : LLM_PROVIDER=${brut}. Valeurs acceptées : ${FOURNISSEURS.join(", ")} ` +
          "(voir .env.example).",
      };
    }
    fournisseur = f;
  }

  const modeJsonBrut = env("LLM_JSON_MODE").toLowerCase();
  const modeJson: ModeJson =
    modeJsonBrut === "on" || modeJsonBrut === "true" || modeJsonBrut === "1"
      ? "on"
      : modeJsonBrut === "off" || modeJsonBrut === "false" || modeJsonBrut === "0"
        ? "off"
        : "auto";
  const timeoutMs = entierPositif(env("LLM_TIMEOUT_MS"), 180_000);
  const temperatureBrut = env("LLM_TEMPERATURE");
  const temperature =
    temperatureBrut !== "" && Number.isFinite(Number(temperatureBrut))
      ? Math.min(2, Math.max(0, Number(temperatureBrut)))
      : null;

  if (fournisseur === "anthropic") {
    const apiKey = env("ANTHROPIC_API_KEY");
    if (!apiKey) {
      return {
        ok: false,
        erreur:
          "Aucune configuration IA : renseignez ANTHROPIC_API_KEY, ou choisissez un fournisseur avec " +
          "LLM_PROVIDER (deepseek, gemini, ollama…) et sa clé LLM_API_KEY (voir .env.example).",
      };
    }
    return {
      ok: true,
      config: {
        fournisseur,
        libelle: "Anthropic",
        baseUrl: "",
        modele: env("LLM_MODEL") || env("ANTHROPIC_MODEL") || "claude-sonnet-4-5",
        apiKey,
        cleRequise: true,
        modeJson: "off",
        maxTokens: entierPositif(env("LLM_MAX_TOKENS"), 16000),
        timeoutMs,
        temperature,
        aide: "https://console.anthropic.com",
      },
    };
  }

  const preset = PRESETS[fournisseur];
  const apiKey = env("LLM_API_KEY");
  if (preset.cleRequise && !apiKey) {
    return {
      ok: false,
      erreur:
        `Clé manquante pour ${preset.libelle} : renseignez LLM_API_KEY dans .env.local ` +
        `(clé à créer sur ${preset.aide}).`,
    };
  }

  const baseUrl = normaliserBaseUrl(env("LLM_BASE_URL") || preset.baseUrl);
  if (!baseUrl) {
    return {
      ok: false,
      erreur:
        `LLM_PROVIDER=${fournisseur} exige LLM_BASE_URL : ${preset.aide}.`,
    };
  }
  if (!/^https?:\/\/[^\s/]+/i.test(baseUrl)) {
    return {
      ok: false,
      erreur: `LLM_BASE_URL invalide (« ${baseUrl} ») : attendu une URL http(s), par exemple http://localhost:11434/v1.`,
    };
  }

  const modele = env("LLM_MODEL") || preset.modeleDefaut;
  if (!modele) {
    return {
      ok: false,
      erreur: `LLM_PROVIDER=${fournisseur} exige LLM_MODEL : indiquez le nom du modèle servi par ${baseUrl}.`,
    };
  }

  return {
    ok: true,
    config: {
      fournisseur,
      libelle: preset.libelle,
      baseUrl,
      modele,
      apiKey,
      cleRequise: preset.cleRequise,
      modeJson: modeJson === "auto" ? (preset.jsonMode ? "on" : "off") : modeJson,
      maxTokens: entierPositif(env("LLM_MAX_TOKENS"), preset.maxTokens),
      timeoutMs,
      temperature,
      aide: preset.aide,
    },
  };
}

/** Libellé lisible, sans secret, pour les écrans et les journaux. */
export function decrireConfiguration(config: ConfigurationIa): string {
  const ou = config.baseUrl ? ` via ${config.baseUrl}` : "";
  return `${config.libelle} — modèle ${config.modele}${ou}`;
}

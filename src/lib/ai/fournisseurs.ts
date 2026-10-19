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
 *
 * Lot 25 — un modèle par tâche. Chaque appel porte une tâche
 * (`TacheIa`), rangée dans une classe : « conception » (plan de
 * formation, structuration d'un import) ou « interaction » (tuteur,
 * exercices personnalisés, analyse de session). Le modèle, puis le
 * fournisseur lui-même, peuvent différer par classe :
 * - LLM_MODEL_CONCEPTION / LLM_MODEL_INTERACTION, repli LLM_MODEL puis
 *   modèle par défaut du préréglage ;
 * - LLM_PROVIDER_INTERACTION (+ LLM_API_KEY_INTERACTION,
 *   LLM_BASE_URL_INTERACTION) : fournisseur distinct pour les données des
 *   apprenants (hypothèse H5 : hébergeur hors Chine pour l'interaction,
 *   API officielle pour la conception). Non activé par défaut.
 * - LLM_THINKING (auto | on | off) : mode « réflexion » des modèles qui
 *   le proposent (DeepSeek V4). En auto : désactivé pour l'interaction
 *   (latence, coût), laissé au modèle pour la conception.
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

/* ------------------------------------------------------------------
   Tâches et classes de tâches (lot 25, étape B)
   ------------------------------------------------------------------ */

export const TACHES_IA = ["conception", "import", "tuteur", "exercices", "analyse_session"] as const;
export type TacheIa = (typeof TACHES_IA)[number];

export type ClasseTache = "conception" | "interaction";

/** Conception (plan, import) ou interaction (données des apprenants). */
export function classeDeTache(tache: TacheIa): ClasseTache {
  return tache === "conception" || tache === "import" ? "conception" : "interaction";
}

/* ------------------------------------------------------------------
   DeepSeek (lot 25, étape A) — vérifié sur https://api-docs.deepseek.com
   le 16 octobre 2026 :
   - modèles servis : `deepseek-flash` (DeepSeek-V4.1-Flash) et
     `deepseek-v4-pro` ; `deepseek-v4-flash` est encore accepté mais
     redirigé vers V4.1-Flash ;
   - `deepseek-chat` et `deepseek-reasoner` ont été retirés le
     24 juillet 2026 ;
   - contexte 1 M, `max_tokens` de 1 à 393 216 (défaut 8 K sans
     réflexion, 64 K avec) ;
   - réflexion activée par défaut ; `thinking: {type: "enabled"|"disabled"}`
     ou `reasoning_effort: "none"|"low"|"high"|"max"` ; le raisonnement
     arrive dans `reasoning_content` (jamais renvoyé à l'utilisateur) ;
   - `response_format: {type: "json_object"}` pris en charge ; le prompt
     doit contenir le mot « json » ; la doc signale des réponses parfois
     vides en mode JSON (gérées par la relance de `appelerLlmJson`).
   ------------------------------------------------------------------ */

export const MODELES_DEEPSEEK = {
  flash: "deepseek-flash",
  pro: "deepseek-v4-pro",
} as const;

export const DATE_RETRAIT_DEEPSEEK = "24 juillet 2026";

/** Anciens noms retirés par DeepSeek → remplaçant conseillé. */
export const MODELES_DEEPSEEK_RETIRES: Record<string, string> = {
  "deepseek-chat": MODELES_DEEPSEEK.flash,
  "deepseek-reasoner": `${MODELES_DEEPSEEK.flash} (avec LLM_THINKING=on) ou ${MODELES_DEEPSEEK.pro}`,
};

/**
 * Message « modèle retiré » si `modele` est un ancien nom DeepSeek,
 * sinon null. Utilisé quand le service répond 400/404 sur ce nom.
 */
export function messageModeleRetire(fournisseur: Fournisseur, modele: string): string | null {
  if (fournisseur !== "deepseek") return null;
  const remplacant = MODELES_DEEPSEEK_RETIRES[modele.trim().toLowerCase()];
  if (!remplacant) return null;
  return (
    `Le modèle « ${modele} » a été retiré par DeepSeek le ${DATE_RETRAIT_DEEPSEEK}. ` +
    `Utilisez ${remplacant} : retirez LLM_MODEL (le défaut est ${MODELES_DEEPSEEK.flash}) ou indiquez ` +
    `LLM_MODEL=${MODELES_DEEPSEEK.flash} / LLM_MODEL_CONCEPTION=${MODELES_DEEPSEEK.pro}.`
  );
}

/** Fonctions aptes à produire du JSON : `response_format` accepté ou non. */
export type ModeJson = "auto" | "on" | "off";

/** LLM_THINKING : auto (selon la classe de tâche) | on | off. */
export type ModeReflexion = "auto" | "on" | "off";

export function analyserModeReflexion(valeur: string): ModeReflexion {
  const v = valeur.trim().toLowerCase();
  if (v === "on" || v === "true" || v === "1" || v === "enabled") return "on";
  if (v === "off" || v === "false" || v === "0" || v === "disabled" || v === "none") return "off";
  return "auto";
}

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
  /** Le serveur comprend-il le paramètre `thinking` (mode réflexion) ? */
  reflexion: boolean;
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
    reflexion: false,
    aide: "https://aistudio.google.com/apikey",
  },
  groq: {
    libelle: "Groq",
    baseUrl: "https://api.groq.com/openai/v1",
    modeleDefaut: "llama-3.3-70b-versatile",
    cleRequise: true,
    jsonMode: true,
    maxTokens: 16000,
    reflexion: false,
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
    reflexion: false,
    aide: "https://openrouter.ai/keys",
  },
  deepseek: {
    libelle: "DeepSeek",
    baseUrl: "https://api.deepseek.com/v1",
    modeleDefaut: MODELES_DEEPSEEK.flash,
    cleRequise: true,
    jsonMode: true,
    // V4 accepte jusqu'à 393 216 jetons en sortie ; 32 768 suffit à un
    // plan de formation complet et borne le coût. LLM_MAX_TOKENS remplace.
    maxTokens: 32768,
    reflexion: true,
    aide: "https://platform.deepseek.com/api_keys",
  },
  openai: {
    libelle: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    modeleDefaut: "gpt-4o-mini",
    cleRequise: true,
    jsonMode: true,
    maxTokens: 16000,
    reflexion: false,
    aide: "https://platform.openai.com/api-keys",
  },
  ollama: {
    libelle: "Ollama",
    baseUrl: "http://localhost:11434/v1",
    modeleDefaut: "deepseek-r1:8b",
    cleRequise: false,
    jsonMode: true,
    maxTokens: 8192,
    reflexion: false,
    aide: "https://ollama.com/download puis « ollama pull <modèle> »",
  },
  vllm: {
    libelle: "vLLM",
    baseUrl: "http://localhost:8000/v1",
    modeleDefaut: "deepseek-ai/DeepSeek-V3",
    cleRequise: false,
    jsonMode: true,
    maxTokens: 8192,
    reflexion: false,
    aide: "https://docs.vllm.ai (serveur « vllm serve <modèle> »)",
  },
  compatible: {
    libelle: "Serveur compatible OpenAI",
    baseUrl: "",
    modeleDefaut: "",
    cleRequise: false,
    jsonMode: false,
    maxTokens: 8192,
    reflexion: false,
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
  /** Tâche demandée et sa classe (lot 25). */
  tache: TacheIa;
  classe: ClasseTache;
  /**
   * Mode réflexion à transmettre : "on" / "off" quand le fournisseur le
   * comprend, null pour ne rien envoyer (fournisseur sans ce paramètre,
   * ou choix laissé au modèle).
   */
  reflexion: "on" | "off" | null;
  /** Le fournisseur comprend-il le paramètre de réflexion ? */
  reflexionPriseEnCharge: boolean;
  /** Fournisseur dédié à la classe (LLM_PROVIDER_INTERACTION) ? */
  fournisseurDedie: boolean;
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

/** Noms des variables lues pour une classe : génériques ou dédiées `_INTERACTION`. */
function variablesPour(dedie: boolean) {
  const s = dedie ? "_INTERACTION" : "";
  return {
    fournisseur: `LLM_PROVIDER${s}`,
    cle: `LLM_API_KEY${s}`,
    baseUrl: `LLM_BASE_URL${s}`,
  };
}

/** Mode réflexion effectif pour une classe de tâche. */
export function reflexionPour(
  mode: ModeReflexion,
  classe: ClasseTache,
  priseEnCharge: boolean
): "on" | "off" | null {
  if (!priseEnCharge) return null;
  if (mode === "on") return "on";
  if (mode === "off") return "off";
  // auto : l'interaction (tuteur, exercices, analyse) privilégie la
  // latence et le coût ; la conception laisse le modèle décider.
  return classe === "interaction" ? "off" : null;
}

/**
 * Résout la configuration complète à partir des variables, pour une
 * tâche donnée. Renvoie une erreur EXPLICITE (en français, actionnable)
 * plutôt qu'une configuration bancale : fournisseur inconnu, clé
 * absente, URL de base manquante ou invalide pour un serveur local.
 */
export function resoudreConfiguration(env: LecteurEnv, tache: TacheIa = "conception"): ResolutionIa {
  const classe = classeDeTache(tache);
  const dedie = classe === "interaction" && env("LLM_PROVIDER_INTERACTION") !== "";
  const V = variablesPour(dedie);

  const brut = env(V.fournisseur);
  let fournisseur: Fournisseur;
  if (!brut) {
    fournisseur = "anthropic";
  } else {
    const f = analyserFournisseur(brut);
    if (!f) {
      return {
        ok: false,
        erreur:
          `Fournisseur IA inconnu : ${V.fournisseur}=${brut}. Valeurs acceptées : ${FOURNISSEURS.join(", ")} ` +
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
  const modeReflexion = analyserModeReflexion(env("LLM_THINKING"));

  // Modèle : par classe, puis générique (sauf fournisseur dédié : son
  // modèle n'a aucune raison d'être celui de l'autre fournisseur), puis
  // défaut du préréglage.
  const modeleParClasse = env(classe === "conception" ? "LLM_MODEL_CONCEPTION" : "LLM_MODEL_INTERACTION");
  const modeleGenerique = dedie ? "" : env("LLM_MODEL");

  if (fournisseur === "anthropic") {
    const apiKey = (dedie ? env(V.cle) : "") || env("ANTHROPIC_API_KEY");
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
        modele: modeleParClasse || modeleGenerique || env("ANTHROPIC_MODEL") || "claude-sonnet-4-5",
        apiKey,
        cleRequise: true,
        modeJson: "off",
        maxTokens: entierPositif(env("LLM_MAX_TOKENS"), 16000),
        timeoutMs,
        temperature,
        aide: "https://console.anthropic.com",
        tache,
        classe,
        reflexion: null,
        reflexionPriseEnCharge: false,
        fournisseurDedie: dedie,
      },
    };
  }

  const preset = PRESETS[fournisseur];
  const apiKey = env(V.cle);
  if (preset.cleRequise && !apiKey) {
    return {
      ok: false,
      erreur:
        `Clé manquante pour ${preset.libelle} : renseignez ${V.cle} dans .env.local ` +
        `(clé à créer sur ${preset.aide}).`,
    };
  }

  const baseUrl = normaliserBaseUrl(env(V.baseUrl) || preset.baseUrl);
  if (!baseUrl) {
    return {
      ok: false,
      erreur: `${V.fournisseur}=${fournisseur} exige ${V.baseUrl} : ${preset.aide}.`,
    };
  }
  if (!/^https?:\/\/[^\s/]+/i.test(baseUrl)) {
    return {
      ok: false,
      erreur: `${V.baseUrl} invalide (« ${baseUrl} ») : attendu une URL http(s), par exemple http://localhost:11434/v1.`,
    };
  }

  const modele = modeleParClasse || modeleGenerique || preset.modeleDefaut;
  if (!modele) {
    return {
      ok: false,
      erreur: `${V.fournisseur}=${fournisseur} exige LLM_MODEL${dedie ? "_INTERACTION" : ""} : indiquez le nom du modèle servi par ${baseUrl}.`,
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
      tache,
      classe,
      reflexion: reflexionPour(modeReflexion, classe, preset.reflexion),
      reflexionPriseEnCharge: preset.reflexion,
      fournisseurDedie: dedie,
    },
  };
}

/** Libellé lisible, sans secret, pour les écrans et les journaux. */
export function decrireConfiguration(config: ConfigurationIa): string {
  const ou = config.baseUrl ? ` via ${config.baseUrl}` : "";
  const reflexion =
    config.reflexion === "off"
      ? ", réflexion désactivée"
      : config.reflexion === "on"
        ? ", réflexion activée"
        : "";
  return `${config.libelle} — modèle ${config.modele}${ou}${reflexion}`;
}

import "server-only";

/**
 * Appel du LLM (API Anthropic) — STRICTEMENT côté serveur.
 * L'import de "server-only" fait échouer la compilation si ce
 * module est importé depuis du code client : la clé API ne peut
 * pas fuiter vers le navigateur.
 *
 * Appel direct de l'API HTTP (pas de dépendance supplémentaire).
 */

export interface ReponseLlm {
  texte: string;
  modele: string;
  inputTokens: number | null;
  outputTokens: number | null;
}

/**
 * Mode simulation : ELITE_IA_MODE=simulation dans .env.local.
 * Permet de tester tout le pipeline sans clé API ni coût ;
 * le contenu produit est clairement étiqueté « démonstration ».
 */
export function modeSimulation(): boolean {
  return process.env.ELITE_IA_MODE === "simulation";
}

/**
 * Fournisseurs pris en charge, réglables sans toucher au code :
 * - LLM_PROVIDER=anthropic  (clé ANTHROPIC_API_KEY)
 * - LLM_PROVIDER=gemini     (GRATUIT — clé LLM_API_KEY via aistudio.google.com)
 * - LLM_PROVIDER=groq       (GRATUIT — clé LLM_API_KEY via console.groq.com)
 * - LLM_PROVIDER=openrouter (modèles ':free' — clé LLM_API_KEY)
 * Gemini/Groq/OpenRouter parlent le protocole « OpenAI compatible ».
 * Sans LLM_PROVIDER : anthropic si ANTHROPIC_API_KEY est définie.
 */
type Fournisseur = "anthropic" | "gemini" | "groq" | "openrouter";

const PRESETS: Record<
  Exclude<Fournisseur, "anthropic">,
  { baseUrl: string; modeleDefaut: string }
> = {
  gemini: {
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    modeleDefaut: "gemini-2.5-flash",
  },
  groq: {
    baseUrl: "https://api.groq.com/openai/v1",
    modeleDefaut: "llama-3.3-70b-versatile",
  },
  openrouter: {
    baseUrl: "https://openrouter.ai/api/v1",
    modeleDefaut: "meta-llama/llama-3.3-70b-instruct:free",
  },
};

export function fournisseurConfigure(): Fournisseur {
  const f = (process.env.LLM_PROVIDER ?? "").toLowerCase();
  if (f === "gemini" || f === "groq" || f === "openrouter") return f;
  return "anthropic";
}

/** Une configuration IA utilisable existe-t-elle (hors simulation) ? */
export function iaConfiguree(): boolean {
  if (fournisseurConfigure() === "anthropic") {
    return Boolean(process.env.ANTHROPIC_API_KEY);
  }
  return Boolean(process.env.LLM_API_KEY);
}

export function modeleConfigure(): string {
  if (modeSimulation()) return "simulation-locale";
  const fournisseur = fournisseurConfigure();
  if (process.env.LLM_MODEL) return process.env.LLM_MODEL;
  if (fournisseur === "anthropic") {
    return process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5";
  }
  return PRESETS[fournisseur].modeleDefaut;
}

function erreurHttp(status: number, fournisseur: string): Error {
  if (status === 401 || status === 403) {
    return new Error(`La clé API ${fournisseur} est invalide ou expirée.`);
  }
  if (status === 429) {
    return new Error(
      "Limite d'utilisation de l'API atteinte (quota gratuit épuisé ?). Réessayez dans quelques minutes."
    );
  }
  return new Error("Le service de génération est indisponible. Réessayez plus tard.");
}

/** Appel via l'API Anthropic. */
async function appelerAnthropic(system: string, prompt: string): Promise<ReponseLlm> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "Aucune configuration IA : renseignez ANTHROPIC_API_KEY, ou un fournisseur gratuit via LLM_PROVIDER + LLM_API_KEY (voir .env.example)."
    );
  }

  const modele = modeleConfigure();
  const reponse = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: modele,
      max_tokens: 16000,
      system,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!reponse.ok) {
    const corps = await reponse.text();
    console.error("[ia] anthropic en échec :", reponse.status, corps.slice(0, 500));
    throw erreurHttp(reponse.status, "Anthropic");
  }

  const donnees = (await reponse.json()) as {
    content?: Array<{ type: string; text?: string }>;
    model?: string;
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  return {
    texte: (donnees.content ?? [])
      .filter((b) => b.type === "text" && typeof b.text === "string")
      .map((b) => b.text)
      .join("\n"),
    modele: donnees.model ?? modele,
    inputTokens: donnees.usage?.input_tokens ?? null,
    outputTokens: donnees.usage?.output_tokens ?? null,
  };
}

/** Appel via un fournisseur « OpenAI compatible » (Gemini, Groq, OpenRouter). */
async function appelerOpenAiCompatible(
  fournisseur: Exclude<Fournisseur, "anthropic">,
  system: string,
  prompt: string
): Promise<ReponseLlm> {
  const apiKey = process.env.LLM_API_KEY;
  if (!apiKey) {
    throw new Error(
      `Clé manquante pour ${fournisseur} : renseignez LLM_API_KEY dans .env.local (voir .env.example).`
    );
  }

  const baseUrl = process.env.LLM_BASE_URL || PRESETS[fournisseur].baseUrl;
  const modele = modeleConfigure();

  const reponse = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: modele,
      max_tokens: 16000,
      messages: [
        { role: "system", content: system },
        { role: "user", content: prompt },
      ],
    }),
  });

  if (!reponse.ok) {
    const corps = await reponse.text();
    console.error(`[ia] ${fournisseur} en échec :`, reponse.status, corps.slice(0, 500));
    throw erreurHttp(reponse.status, fournisseur);
  }

  const donnees = (await reponse.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    model?: string;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  return {
    texte: donnees.choices?.[0]?.message?.content ?? "",
    modele: donnees.model ?? modele,
    inputTokens: donnees.usage?.prompt_tokens ?? null,
    outputTokens: donnees.usage?.completion_tokens ?? null,
  };
}

export async function appelerLlm(
  system: string,
  prompt: string
): Promise<ReponseLlm> {
  const fournisseur = fournisseurConfigure();
  if (fournisseur === "anthropic") return appelerAnthropic(system, prompt);
  return appelerOpenAiCompatible(fournisseur, system, prompt);
}

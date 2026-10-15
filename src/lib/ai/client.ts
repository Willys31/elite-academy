import "server-only";
import { lireEnv } from "@/lib/ai/env";
import {
  decrireConfiguration,
  resoudreConfiguration,
  type ConfigurationIa,
  type Fournisseur,
} from "@/lib/ai/fournisseurs";
import { extraireJson } from "@/lib/ai/json";
import {
  appelerChatCompletions,
  erreurHttp,
  erreurReseau,
  type ReponseLlm,
} from "@/lib/ai/openai-compatible";

/**
 * Appel du LLM — STRICTEMENT côté serveur.
 * L'import de "server-only" fait échouer la compilation si ce
 * module est importé depuis du code client : la clé API ne peut
 * pas fuiter vers le navigateur.
 *
 * Ce fichier ne contient que le « câblage » : la résolution de la
 * configuration (`fournisseurs.ts`), l'appel compatible OpenAI
 * (`openai-compatible.ts`) et l'extraction JSON (`json.ts`) sont des
 * modules purs, testés sans réseau.
 *
 * Fournisseurs (LLM_PROVIDER) :
 * - anthropic (ANTHROPIC_API_KEY) — API Anthropic ;
 * - deepseek, openai, gemini, groq, openrouter — services en ligne,
 *   protocole OpenAI compatible, clé LLM_API_KEY ;
 * - ollama, vllm, compatible — serveur local ou auto-hébergé, sans clé
 *   obligatoire, URL via LLM_BASE_URL.
 * Appel direct de l'API HTTP : aucune dépendance supplémentaire.
 */

export type { ReponseLlm };

/**
 * Mode simulation : ELITE_IA_MODE=simulation dans .env.local.
 * Permet de tester tout le pipeline sans clé API ni coût ;
 * le contenu produit est clairement étiqueté « démonstration ».
 */
export function modeSimulation(): boolean {
  return lireEnv("ELITE_IA_MODE").toLowerCase() === "simulation";
}

/** Configuration résolue depuis l'environnement (ou l'erreur à afficher). */
export function configurationIa() {
  return resoudreConfiguration(lireEnv);
}

/** Fournisseur déclaré (anthropic par défaut, même si mal configuré). */
export function fournisseurConfigure(): Fournisseur {
  const r = configurationIa();
  return r.ok ? r.config.fournisseur : "anthropic";
}

/** Une configuration IA utilisable existe-t-elle (hors simulation) ? */
export function iaConfiguree(): boolean {
  return configurationIa().ok;
}

/**
 * Pourquoi l'IA n'est pas utilisable, en français, sans secret ;
 * null si tout va bien ou en simulation.
 */
export function erreurConfigurationIa(): string | null {
  if (modeSimulation()) return null;
  const r = configurationIa();
  return r.ok ? null : r.erreur;
}

export function modeleConfigure(): string {
  if (modeSimulation()) return "simulation-locale";
  const r = configurationIa();
  if (r.ok) return r.config.modele;
  // Mal configuré : on renvoie quand même le modèle demandé, pour la
  // traçabilité (`ai_generations.model_name`).
  return lireEnv("LLM_MODEL") || lireEnv("ANTHROPIC_MODEL") || "non-configure";
}

/** Libellé lisible (« DeepSeek — modèle deepseek-chat ») pour les écrans. */
export function descriptionIa(): string {
  if (modeSimulation()) return "Simulation locale (sans IA)";
  const r = configurationIa();
  return r.ok ? decrireConfiguration(r.config) : "IA non configurée";
}

function exigerConfiguration(): ConfigurationIa {
  const r = configurationIa();
  if (!r.ok) throw new Error(r.erreur);
  return r.config;
}

/** Appel via l'API Anthropic. */
async function appelerAnthropic(config: ConfigurationIa, system: string, prompt: string): Promise<ReponseLlm> {
  let reponse: Response;
  try {
    reponse = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": config.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: config.modele,
        max_tokens: config.maxTokens,
        ...(config.temperature !== null ? { temperature: config.temperature } : {}),
        system,
        messages: [{ role: "user", content: prompt }],
      }),
      signal: AbortSignal.timeout(config.timeoutMs),
    });
  } catch (e) {
    throw erreurReseau(e, config);
  }

  if (!reponse.ok) {
    const corps = await reponse.text();
    console.error("[ia] anthropic en échec :", reponse.status, corps.slice(0, 500));
    throw erreurHttp(reponse.status, config, corps);
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
    modele: donnees.model ?? config.modele,
    inputTokens: donnees.usage?.input_tokens ?? null,
    outputTokens: donnees.usage?.output_tokens ?? null,
  };
}

/**
 * Appel texte libre (tuteur). `json: true` demande au serveur une
 * sortie JSON quand il le permet ; préférer `appelerLlmJson` pour
 * obtenir l'objet déjà extrait, avec relance.
 */
export async function appelerLlm(
  system: string,
  prompt: string,
  options: { json?: boolean } = {}
): Promise<ReponseLlm> {
  const config = exigerConfiguration();
  if (config.fournisseur === "anthropic") return appelerAnthropic(config, system, prompt);
  return appelerChatCompletions(
    config,
    { system, prompt, json: options.json },
    (url, init) => fetch(url, init),
    (m) => console.error(m)
  );
}

export interface ReponseLlmJson extends ReponseLlm {
  /** Objet extrait de la réponse, ou null si aucun JSON exploitable. */
  json: unknown | null;
  /** Nombre d'appels effectués (2 si une relance a été nécessaire). */
  tentatives: number;
}

const RAPPEL_JSON =
  "\n\nRAPPEL IMPORTANT : ta réponse précédente n'était pas un JSON valide. Réponds UNIQUEMENT avec l'objet JSON demandé, " +
  "sans aucun texte avant ni après, sans balise de code, sans commentaire.";

/**
 * Appel attendant un objet JSON : mode JSON du serveur quand il existe,
 * extraction tolérante, et UNE relance avec consigne renforcée si la
 * réponse n'est pas exploitable (modèles locaux ou raisonneurs qui
 * n'honorent pas toujours le format). Les jetons des deux appels sont
 * additionnés pour la traçabilité.
 */
export async function appelerLlmJson(system: string, prompt: string): Promise<ReponseLlmJson> {
  const premiere = await appelerLlm(system, prompt, { json: true });
  const json = extraireJson(premiere.texte);
  if (json !== null) return { ...premiere, json, tentatives: 1 };

  console.error(
    `[ia] réponse sans JSON exploitable (${premiere.texte.length} caractères) : relance avec consigne renforcée.`
  );
  const seconde = await appelerLlm(system, prompt + RAPPEL_JSON, { json: true });
  const additionner = (a: number | null, b: number | null) =>
    a === null && b === null ? null : (a ?? 0) + (b ?? 0);
  return {
    texte: seconde.texte,
    modele: seconde.modele,
    inputTokens: additionner(premiere.inputTokens, seconde.inputTokens),
    outputTokens: additionner(premiere.outputTokens, seconde.outputTokens),
    json: extraireJson(seconde.texte),
    tentatives: 2,
  };
}

import "server-only";
import { lireEnv } from "@/lib/ai/env";
import {
  decrireConfiguration,
  resoudreConfiguration,
  type ConfigurationIa,
  type Fournisseur,
  type TacheIa,
} from "@/lib/ai/fournisseurs";
import {
  appelerJsonAvecRelances,
  type OptionsRelance,
  type ReponseLlmJson,
} from "@/lib/ai/appel-json";
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
 * (`openai-compatible.ts`), l'extraction JSON (`json.ts`) et les
 * relances (`appel-json.ts`) sont des modules purs, testés sans réseau.
 *
 * Fournisseurs (LLM_PROVIDER) :
 * - anthropic (ANTHROPIC_API_KEY) — API Anthropic ;
 * - deepseek, openai, gemini, groq, openrouter — services en ligne,
 *   protocole OpenAI compatible, clé LLM_API_KEY ;
 * - ollama, vllm, compatible — serveur local ou auto-hébergé, sans clé
 *   obligatoire, URL via LLM_BASE_URL.
 * Appel direct de l'API HTTP : aucune dépendance supplémentaire.
 *
 * Lot 25 : chaque fonction reçoit la tâche (`TacheIa`) ; le modèle et
 * le fournisseur peuvent en dépendre (voir `fournisseurs.ts`).
 */

export type { ReponseLlm, ReponseLlmJson, TacheIa };
export { additionnerJetons } from "@/lib/ai/appel-json";

/**
 * Mode simulation : ELITE_IA_MODE=simulation dans .env.local.
 * Permet de tester tout le pipeline sans clé API ni coût ;
 * le contenu produit est clairement étiqueté « démonstration ».
 */
export function modeSimulation(): boolean {
  return lireEnv("ELITE_IA_MODE").toLowerCase() === "simulation";
}

/** Configuration résolue depuis l'environnement (ou l'erreur à afficher). */
export function configurationIa(tache: TacheIa = "conception") {
  return resoudreConfiguration(lireEnv, tache);
}

/** Fournisseur déclaré (anthropic par défaut, même si mal configuré). */
export function fournisseurConfigure(tache: TacheIa = "conception"): Fournisseur {
  const r = configurationIa(tache);
  return r.ok ? r.config.fournisseur : "anthropic";
}

/** Une configuration IA utilisable existe-t-elle (hors simulation) ? */
export function iaConfiguree(tache: TacheIa = "conception"): boolean {
  return configurationIa(tache).ok;
}

/**
 * Pourquoi l'IA n'est pas utilisable, en français, sans secret ;
 * null si tout va bien ou en simulation.
 */
export function erreurConfigurationIa(tache: TacheIa = "conception"): string | null {
  if (modeSimulation()) return null;
  const r = configurationIa(tache);
  return r.ok ? null : r.erreur;
}

export function modeleConfigure(tache: TacheIa = "conception"): string {
  if (modeSimulation()) return "simulation-locale";
  const r = configurationIa(tache);
  if (r.ok) return r.config.modele;
  // Mal configuré : on renvoie quand même le modèle demandé, pour la
  // traçabilité (`ai_generations.model_name`).
  return lireEnv("LLM_MODEL") || lireEnv("ANTHROPIC_MODEL") || "non-configure";
}

/** Libellé lisible (« DeepSeek — modèle deepseek-flash ») pour les écrans. */
export function descriptionIa(tache: TacheIa = "conception"): string {
  if (modeSimulation()) return "Simulation locale (sans IA)";
  const r = configurationIa(tache);
  return r.ok ? decrireConfiguration(r.config) : "IA non configurée";
}

/**
 * Trace de la configuration IA pour `ai_generations.context` (aucune
 * migration : la colonne est un jsonb). Sans secret.
 */
export function traceIa(tache: TacheIa): Record<string, unknown> {
  if (modeSimulation()) return { tache, simulation: true };
  const r = configurationIa(tache);
  if (!r.ok) return { tache, erreur_configuration: r.erreur };
  return {
    tache,
    classe: r.config.classe,
    fournisseur: r.config.fournisseur,
    modele_demande: r.config.modele,
    reflexion: r.config.reflexion,
    fournisseur_dedie: r.config.fournisseurDedie,
  };
}

function exigerConfiguration(tache: TacheIa): ConfigurationIa {
  const r = configurationIa(tache);
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
    stop_reason?: string;
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  return {
    texte: (donnees.content ?? [])
      .filter((b) => b.type === "text" && typeof b.text === "string")
      .map((b) => b.text)
      .join("\n"),
    modele: donnees.model ?? config.modele,
    fournisseur: "anthropic",
    inputTokens: donnees.usage?.input_tokens ?? null,
    outputTokens: donnees.usage?.output_tokens ?? null,
    tronquee: donnees.stop_reason === "max_tokens",
  };
}

export interface OptionsAppel extends OptionsRelance {
  /** Tâche : décide du modèle et du fournisseur (défaut : conception). */
  tache?: TacheIa;
  /** Demander une sortie JSON au serveur quand il le permet. */
  json?: boolean;
}

/**
 * Appel texte libre (tuteur). `json: true` demande au serveur une
 * sortie JSON quand il le permet ; préférer `appelerLlmJson` pour
 * obtenir l'objet déjà extrait, avec relances.
 */
export async function appelerLlm(
  system: string,
  prompt: string,
  options: OptionsAppel = {}
): Promise<ReponseLlm> {
  const base = exigerConfiguration(options.tache ?? "conception");
  const config: ConfigurationIa =
    options.reflexion && base.reflexionPriseEnCharge ? { ...base, reflexion: options.reflexion } : base;
  if (config.fournisseur === "anthropic") return appelerAnthropic(config, system, prompt);
  return appelerChatCompletions(
    config,
    { system, prompt, json: options.json },
    (url, init) => fetch(url, init),
    (m) => console.error(m)
  );
}

/**
 * Appel attendant un objet JSON : mode JSON du serveur quand il existe,
 * extraction tolérante, et relances (`appel-json.ts`) : sans réflexion
 * si la réponse est tronquée, avec consigne renforcée si elle n'est pas
 * du JSON. Les jetons des appels sont additionnés pour la traçabilité.
 */
export async function appelerLlmJson(
  system: string,
  prompt: string,
  options: Omit<OptionsAppel, "json" | "reflexion"> = {}
): Promise<ReponseLlmJson> {
  const config = exigerConfiguration(options.tache ?? "conception");
  return appelerJsonAvecRelances(
    (p, relance) => appelerLlm(system, p, { ...options, json: true, reflexion: relance.reflexion }),
    prompt,
    config,
    (m) => console.error(m)
  );
}

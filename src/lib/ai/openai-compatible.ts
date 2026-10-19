/**
 * Appel d'un serveur « OpenAI compatible » (route `/chat/completions`)
 * — logique pure : `fetch` est injecté, aucune lecture de `process.env`,
 * ce qui permet de tester la construction de la requête, les replis et
 * les messages d'erreur sans réseau. `client.ts` (server-only) s'en
 * sert avec la configuration résolue par `fournisseurs.ts`.
 */

import { messageModeleRetire, type ConfigurationIa, type Fournisseur } from "@/lib/ai/fournisseurs";

export interface ReponseLlm {
  texte: string;
  modele: string;
  /** Fournisseur réellement appelé (traçabilité par tâche, lot 25). */
  fournisseur: Fournisseur;
  inputTokens: number | null;
  outputTokens: number | null;
  /** Réponse coupée au plafond `max_tokens` (`finish_reason: length`). */
  tronquee: boolean;
}

export interface RequeteLlm {
  system: string;
  prompt: string;
  /** Demander une sortie JSON (`response_format`) quand le serveur le permet. */
  json?: boolean;
}

export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }
) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

/** Message d'erreur du serveur, extrait du corps JSON s'il existe. */
export function messageDuCorps(corps: string): string {
  try {
    const d = JSON.parse(corps) as { error?: { message?: string } | string; message?: string };
    if (typeof d.error === "string") return d.error;
    if (d.error && typeof d.error.message === "string") return d.error.message;
    if (typeof d.message === "string") return d.message;
  } catch {
    /* corps non JSON */
  }
  return corps.replace(/\s+/g, " ").trim().slice(0, 200);
}

/** Traduit un statut HTTP en message explicite pour l'utilisateur. */
export function erreurHttp(status: number, config: ConfigurationIa, corps: string): Error {
  const detail = messageDuCorps(corps);
  const nom = config.libelle;
  if (status === 401 || status === 403) {
    if (config.fournisseur === "gemini" && config.apiKey.startsWith("AQ.")) {
      return new Error(
        "La clé Gemini est refusée : une clé « AQ.… » vient de Vertex AI. Créez une clé sur https://aistudio.google.com/apikey (elle commence par « AIza »)."
      );
    }
    return new Error(
      config.cleRequise
        ? `La clé API ${nom} est invalide ou expirée (LLM_API_KEY).`
        : `Le serveur ${nom} refuse l'accès (${status}) : vérifiez LLM_API_KEY si le serveur en exige une.`
    );
  }
  if (status === 402) {
    return new Error(
      `Solde insuffisant sur le compte ${nom} : rechargez le crédit du compte API avant de relancer.`
    );
  }
  // Ancien nom DeepSeek (deepseek-chat, deepseek-reasoner) : le service
  // répond 400 « Model Not Exist » ou 404 ; on explique le retrait.
  if (status === 400 || status === 404 || status === 422) {
    const retire = messageModeleRetire(config.fournisseur, config.modele);
    if (retire) return new Error(retire);
  }
  if (status === 404) {
    const conseil =
      config.fournisseur === "ollama"
        ? ` Téléchargez-le avec « ollama pull ${config.modele} » ou changez LLM_MODEL.`
        : " Vérifiez LLM_MODEL et LLM_BASE_URL.";
    return new Error(`Modèle « ${config.modele} » introuvable chez ${nom}.${conseil}`);
  }
  if (status === 429) {
    return new Error(
      `Limite d'utilisation de ${nom} atteinte (quota ou crédit épuisé ?). Réessayez dans quelques minutes.`
    );
  }
  if (status === 400 || status === 422) {
    if (config.fournisseur === "gemini" && /api key/i.test(corps)) {
      const indice = config.apiKey.startsWith("AQ.")
        ? " Cette clé (« AQ.… ») vient de Vertex AI ; elle n'est pas acceptée ici."
        : "";
      return new Error(
        `La clé Gemini est refusée.${indice} Créez une clé sur https://aistudio.google.com/apikey (elle commence par « AIza ») et placez-la dans LLM_API_KEY.`
      );
    }
    return new Error(
      `Requête refusée par ${nom} (${status})${detail ? ` : ${detail}` : ""}. Vérifiez LLM_MODEL et LLM_MAX_TOKENS.`
    );
  }
  if (status >= 500) {
    return new Error(
      `Le service ${nom} est indisponible (${status})${detail ? ` : ${detail}` : ""}. Réessayez plus tard.`
    );
  }
  return new Error(`Le service ${nom} a répondu ${status}${detail ? ` : ${detail}` : ""}.`);
}

/** Erreur réseau (serveur local éteint, DNS, délai dépassé) en français. */
export function erreurReseau(e: unknown, config: ConfigurationIa): Error {
  const cause = (e as { cause?: { code?: string } })?.cause?.code ?? "";
  const nomErreur = (e as { name?: string })?.name ?? "";
  if (nomErreur === "TimeoutError" || nomErreur === "AbortError") {
    return new Error(
      `${config.libelle} n'a pas répondu dans le délai de ${Math.round(config.timeoutMs / 1000)} s ` +
        "(LLM_TIMEOUT_MS). Un modèle local trop lourd pour la machine ? Réessayez ou choisissez un modèle plus léger."
    );
  }
  if (cause === "ECONNREFUSED" || cause === "ENOTFOUND" || cause === "ECONNRESET" || cause === "EAI_AGAIN") {
    return new Error(
      `Impossible de joindre ${config.libelle} à l'adresse ${config.baseUrl} (${cause}). ` +
        (config.cleRequise
          ? "Vérifiez la connexion réseau et LLM_BASE_URL."
          : "Le serveur local est-il démarré ? Vérifiez LLM_BASE_URL.")
    );
  }
  const message = e instanceof Error ? e.message : String(e);
  return new Error(`Échec de l'appel à ${config.libelle} : ${message}`);
}

/** Corps de la requête `/chat/completions`. */
export function construireCorps(
  config: ConfigurationIa,
  requete: RequeteLlm,
  options: { avecJson: boolean }
): Record<string, unknown> {
  const corps: Record<string, unknown> = {
    model: config.modele,
    max_tokens: config.maxTokens,
    messages: [
      { role: "system", content: requete.system },
      { role: "user", content: requete.prompt },
    ],
  };
  if (config.temperature !== null) corps.temperature = config.temperature;
  if (options.avecJson) corps.response_format = { type: "json_object" };
  // Mode réflexion (DeepSeek V4) : transmis seulement aux fournisseurs
  // qui le comprennent, et seulement quand un choix est fait (LLM_THINKING
  // ou classe « interaction » en auto). Le raisonnement renvoyé dans
  // `reasoning_content` n'est jamais lu ni stocké.
  if (config.reflexionPriseEnCharge && config.reflexion !== null) {
    corps.thinking = { type: config.reflexion === "on" ? "enabled" : "disabled" };
  }
  return corps;
}

interface CorpsReponse {
  choices?: Array<{
    message?: { content?: string | Array<{ type?: string; text?: string }>; reasoning_content?: string };
    finish_reason?: string;
  }>;
  model?: string;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    completion_tokens_details?: { reasoning_tokens?: number };
  };
}

/** Contenu textuel d'un choix, quel que soit le format (chaîne ou blocs). */
export function texteDuChoix(reponse: CorpsReponse): string {
  const contenu = reponse.choices?.[0]?.message?.content;
  if (typeof contenu === "string") return contenu;
  if (Array.isArray(contenu)) {
    return contenu
      .filter((b) => typeof b?.text === "string")
      .map((b) => b.text as string)
      .join("\n");
  }
  return "";
}

/**
 * Appelle `/chat/completions`. Si le serveur refuse `response_format`
 * (400 mentionnant ce champ), rejoue une fois sans : les modèles qui
 * ne garantissent pas le mode JSON passent alors par le repli textuel
 * de `extraireJson`.
 */
export async function appelerChatCompletions(
  config: ConfigurationIa,
  requete: RequeteLlm,
  fetchImpl: FetchLike,
  journal: (message: string) => void = () => {}
): Promise<ReponseLlm> {
  const url = `${config.baseUrl}/chat/completions`;
  const headers: Record<string, string> = { "content-type": "application/json" };
  // Ollama/vLLM acceptent n'importe quel jeton ; certains proxys exigent
  // l'en-tête : on l'envoie dès qu'une clé est fournie, et une valeur
  // factice pour un serveur local sans clé.
  headers.authorization = `Bearer ${config.apiKey || "sans-cle"}`;

  let avecJson = Boolean(requete.json) && config.modeJson === "on";
  for (let tentative = 0; tentative < 2; tentative++) {
    let reponse: Awaited<ReturnType<FetchLike>>;
    try {
      reponse = await fetchImpl(url, {
        method: "POST",
        headers,
        body: JSON.stringify(construireCorps(config, requete, { avecJson })),
        signal: typeof AbortSignal !== "undefined" && "timeout" in AbortSignal
          ? AbortSignal.timeout(config.timeoutMs)
          : undefined,
      });
    } catch (e) {
      throw erreurReseau(e, config);
    }

    if (!reponse.ok) {
      const corps = await reponse.text();
      journal(`[ia] ${config.fournisseur} en échec : ${reponse.status} ${corps.slice(0, 500)}`);
      if (avecJson && reponse.status === 400 && /response_format|json_object|json mode/i.test(corps)) {
        avecJson = false;
        continue;
      }
      throw erreurHttp(reponse.status, config, corps);
    }

    const texteBrut = await reponse.text();
    let donnees: CorpsReponse;
    try {
      donnees = JSON.parse(texteBrut) as CorpsReponse;
    } catch {
      throw new Error(
        `${config.libelle} a renvoyé une réponse illisible (pas du JSON). LLM_BASE_URL pointe-t-il bien vers une API compatible OpenAI (…/v1) ?`
      );
    }
    const texte = texteDuChoix(donnees);
    const fin = donnees.choices?.[0]?.finish_reason;
    if (fin === "length") {
      const raisonnement = donnees.usage?.completion_tokens_details?.reasoning_tokens;
      journal(
        `[ia] ${config.fournisseur} : réponse tronquée (max_tokens=${config.maxTokens}` +
          (raisonnement ? `, dont ${raisonnement} jetons de réflexion` : "") +
          ")"
      );
    }
    return {
      texte,
      modele: donnees.model ?? config.modele,
      fournisseur: config.fournisseur,
      inputTokens: donnees.usage?.prompt_tokens ?? null,
      outputTokens: donnees.usage?.completion_tokens ?? null,
      tronquee: fin === "length",
    };
  }
  throw new Error(`Le service ${config.libelle} n'a pas pu être appelé.`);
}

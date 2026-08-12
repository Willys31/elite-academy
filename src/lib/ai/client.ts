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

export function modeleConfigure(): string {
  if (modeSimulation()) return "simulation-locale";
  return process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5";
}

export async function appelerLlm(
  system: string,
  prompt: string
): Promise<ReponseLlm> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "Clé API manquante : renseignez ANTHROPIC_API_KEY dans .env.local (côté serveur uniquement)."
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
    // Journal serveur uniquement ; jamais renvoyé tel quel à l'utilisateur.
    console.error("[ia] appel LLM en échec :", reponse.status, corps.slice(0, 500));
    if (reponse.status === 401) {
      throw new Error("La clé API Anthropic est invalide ou expirée.");
    }
    if (reponse.status === 429) {
      throw new Error("Limite d'utilisation de l'API atteinte. Réessayez dans quelques minutes.");
    }
    throw new Error("Le service de génération est indisponible. Réessayez plus tard.");
  }

  const donnees = (await reponse.json()) as {
    content?: Array<{ type: string; text?: string }>;
    model?: string;
    usage?: { input_tokens?: number; output_tokens?: number };
  };

  const texte = (donnees.content ?? [])
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text)
    .join("\n");

  return {
    texte,
    modele: donnees.model ?? modele,
    inputTokens: donnees.usage?.input_tokens ?? null,
    outputTokens: donnees.usage?.output_tokens ?? null,
  };
}

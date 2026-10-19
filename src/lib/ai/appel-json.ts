/**
 * Appel JSON avec relances — logique pure (l'appel brut est injecté),
 * partagée par `client.ts` (assistant, import, tuteur…) et le banc
 * d'essai, pour que les deux mesurent exactement le même comportement.
 *
 * Trois relances possibles, chacune au plus une fois :
 * 1. réponse TRONQUÉE (`finish_reason: length`) chez un fournisseur qui
 *    comprend la réflexion et sans réflexion déjà coupée → rejouer sans
 *    réflexion : les jetons de raisonnement ne consomment plus le budget
 *    de sortie (constaté le 19/10/2026 : 9 005 jetons de réflexion dans un
 *    plafond de 32 768, JSON coupé) ;
 * 2. réponse encore tronquée → erreur claire (LLM_MAX_TOKENS) plutôt
 *    qu'un JSON partiel pris pour un résultat ;
 * 3. réponse complète mais sans JSON exploitable → une relance avec
 *    consigne renforcée (comportement du lot 24).
 * Les jetons de tous les appels sont additionnés pour la traçabilité.
 */

import { extraireJson } from "@/lib/ai/json";
import type { ReponseLlm } from "@/lib/ai/openai-compatible";

export interface OptionsRelance {
  /** Forcer le mode réflexion pour cet appel (relance sans réflexion). */
  reflexion?: "on" | "off";
}

export type AppelBrut = (prompt: string, options: OptionsRelance) => Promise<ReponseLlm>;

export interface ContexteRelance {
  libelle: string;
  maxTokens: number;
  reflexionPriseEnCharge: boolean;
  reflexion: "on" | "off" | null;
}

export interface ReponseLlmJson extends ReponseLlm {
  /** Objet extrait de la réponse, ou null si aucun JSON exploitable. */
  json: unknown | null;
  /** Nombre d'appels effectués (relances comprises). */
  tentatives: number;
  /** La réflexion a-t-elle été coupée après une troncature ? */
  reflexionCoupee: boolean;
}

export const RAPPEL_JSON =
  "\n\nRAPPEL IMPORTANT : ta réponse précédente n'était pas un JSON valide. Réponds UNIQUEMENT avec l'objet JSON demandé, " +
  "sans aucun texte avant ni après, sans balise de code, sans commentaire.";

/** Somme de jetons tolérante aux valeurs absentes. */
export function additionnerJetons(a: number | null, b: number | null): number | null {
  return a === null && b === null ? null : (a ?? 0) + (b ?? 0);
}

/** Message d'erreur d'une réponse tronquée, avec la variable à ajuster. */
export function messageTronque(ctx: ContexteRelance, reflexionCoupee: boolean): string {
  const conseil = ctx.reflexionPriseEnCharge && !reflexionCoupee && ctx.reflexion !== "off"
    ? " ou désactivez la réflexion (LLM_THINKING=off)"
    : "";
  return (
    `La réponse de ${ctx.libelle} a été coupée au plafond de ${ctx.maxTokens} jetons : le contenu généré est incomplet et n'a pas été enregistré. ` +
    `Augmentez LLM_MAX_TOKENS${conseil}, ou demandez une formation plus courte.`
  );
}

export async function appelerJsonAvecRelances(
  appeler: AppelBrut,
  prompt: string,
  ctx: ContexteRelance,
  journal: (message: string) => void = () => {}
): Promise<ReponseLlmJson> {
  let reponse = await appeler(prompt, {});
  let tentatives = 1;
  let inputTokens = reponse.inputTokens;
  let outputTokens = reponse.outputTokens;
  let reflexionCoupee = false;
  const options: OptionsRelance = {};

  const cumuler = (r: ReponseLlm) => {
    tentatives += 1;
    inputTokens = additionnerJetons(inputTokens, r.inputTokens);
    outputTokens = additionnerJetons(outputTokens, r.outputTokens);
    reponse = r;
  };

  if (reponse.tronquee) {
    if (ctx.reflexionPriseEnCharge && ctx.reflexion !== "off") {
      journal(`[ia] réponse tronquée (max_tokens=${ctx.maxTokens}) : relance sans réflexion.`);
      options.reflexion = "off";
      reflexionCoupee = true;
      cumuler(await appeler(prompt, options));
    }
    if (reponse.tronquee) {
      throw new Error(messageTronque(ctx, reflexionCoupee));
    }
  }

  let json = extraireJson(reponse.texte);
  if (json === null) {
    journal(`[ia] réponse sans JSON exploitable (${reponse.texte.length} caractères) : relance avec consigne renforcée.`);
    cumuler(await appeler(prompt + RAPPEL_JSON, options));
    if (reponse.tronquee) throw new Error(messageTronque(ctx, reflexionCoupee));
    json = extraireJson(reponse.texte);
  }

  return { ...reponse, inputTokens, outputTokens, json, tentatives, reflexionCoupee };
}

/**
 * Relance de réparation — lot 25, étape E. Logique pure : la fonction
 * d'appel au modèle est injectée, ce qui permet de tester le parcours
 * sans réseau. `client.ts` fournit l'appel réel.
 *
 * Règle : quand le contrôle pédagogique relève des erreurs BLOQUANTES,
 * on renvoie UNE fois au modèle la liste exacte des erreurs et sa
 * réponse précédente, en lui demandant le JSON complet corrigé. Les
 * jetons des appels sont additionnés. Au second échec : erreur claire,
 * rien n'est enregistré.
 */

import type { Probleme } from "@/lib/ai/controle-pedagogique";

export interface ReponseJsonMinimale {
  json: unknown | null;
  modele: string;
  fournisseur: string;
  inputTokens: number | null;
  outputTokens: number | null;
  /** Appels HTTP effectués par cette réponse (relance JSON comprise). */
  tentatives: number;
}

export type Verification<T> =
  | { ok: true; valeur: T; avertissements: Probleme[] }
  | { ok: false; erreurs: Probleme[]; avertissements: Probleme[] };

export interface BilanAppels {
  modele: string;
  fournisseur: string;
  inputTokens: number | null;
  outputTokens: number | null;
  /** Nombre total d'appels HTTP (réparation et relances JSON comprises). */
  appels: number;
  /** Une relance de réparation a-t-elle eu lieu ? */
  reparee: boolean;
  /** Erreurs bloquantes du premier résultat (vides si aucune réparation). */
  erreursInitiales: Probleme[];
}

export type ResultatReparation<T> =
  | { ok: true; valeur: T; avertissements: Probleme[]; bilan: BilanAppels }
  | { ok: false; erreur: string; bilan: BilanAppels };

function additionner(a: number | null, b: number | null): number | null {
  return a === null && b === null ? null : (a ?? 0) + (b ?? 0);
}

/** Message utilisateur de réparation : erreurs exactes + réponse précédente. */
export function construirePromptReparation(promptInitial: string, jsonPrecedent: unknown, erreurs: Probleme[]): string {
  const liste = erreurs.map((e, i) => `${i + 1}. [${e.code}] (${e.chemin}) ${e.message}`).join("\n");
  return `${promptInitial}

===== RÉPARATION DEMANDÉE =====
Ta réponse précédente (ci-dessous) a été refusée par le contrôle pédagogique pour les erreurs suivantes :
${liste}

Corrige UNIQUEMENT ce qui est nécessaire pour lever ces erreurs, sans dégrader le reste, et renvoie le JSON COMPLET corrigé (pas seulement les parties modifiées), en respectant strictement la structure demandée. Réponds uniquement avec l'objet JSON.

Réponse précédente :
${JSON.stringify(jsonPrecedent)}
===== FIN DE LA RÉPARATION =====`;
}

/** Erreur claire quand la réparation n'a pas suffi. */
export function messageEchecControle(erreurs: Probleme[], apresReparation: boolean): string {
  const tete = apresReparation
    ? "Le plan généré ne respecte toujours pas les règles pédagogiques après une relance de réparation ; rien n'a été enregistré."
    : "Le plan généré ne respecte pas les règles pédagogiques ; rien n'a été enregistré.";
  const detail = erreurs
    .slice(0, 6)
    .map((e) => `– ${e.message}`)
    .join("\n");
  const reste = erreurs.length > 6 ? `\n– … et ${erreurs.length - 6} autre(s).` : "";
  return `${tete}\n${detail}${reste}\nRelancez la génération, éventuellement en précisant le brief.`;
}

/**
 * Génère, vérifie, et répare une fois si nécessaire.
 * - `appeler(prompt)` : appel JSON au modèle (déjà muni de sa relance JSON) ;
 * - `verifier(json)` : validation de structure + contrôle pédagogique.
 */
export async function genererAvecReparation<T>(
  appeler: (prompt: string) => Promise<ReponseJsonMinimale>,
  prompt: string,
  verifier: (json: unknown) => Verification<T>,
  options: { reparer?: boolean } = {}
): Promise<ResultatReparation<T>> {
  const premiere = await appeler(prompt);
  const bilan: BilanAppels = {
    modele: premiere.modele,
    fournisseur: premiere.fournisseur,
    inputTokens: premiere.inputTokens,
    outputTokens: premiere.outputTokens,
    appels: premiere.tentatives,
    reparee: false,
    erreursInitiales: [],
  };

  const v1 = verifier(premiere.json);
  if (v1.ok) return { ok: true, valeur: v1.valeur, avertissements: v1.avertissements, bilan };

  // Sans JSON exploitable, la réparation n'a rien à corriger : échec net.
  if (premiere.json === null || options.reparer === false) {
    return { ok: false, erreur: messageEchecControle(v1.erreurs, false), bilan };
  }

  const seconde = await appeler(construirePromptReparation(prompt, premiere.json, v1.erreurs));
  const bilan2: BilanAppels = {
    modele: seconde.modele,
    fournisseur: seconde.fournisseur,
    inputTokens: additionner(premiere.inputTokens, seconde.inputTokens),
    outputTokens: additionner(premiere.outputTokens, seconde.outputTokens),
    appels: premiere.tentatives + seconde.tentatives,
    reparee: true,
    erreursInitiales: v1.erreurs,
  };
  const v2 = verifier(seconde.json);
  if (v2.ok) return { ok: true, valeur: v2.valeur, avertissements: v2.avertissements, bilan: bilan2 };
  return { ok: false, erreur: messageEchecControle(v2.erreurs, true), bilan: bilan2 };
}

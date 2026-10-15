/**
 * Extraction robuste d'un objet JSON dans la réponse d'un modèle —
 * logique pure, testée unitairement.
 *
 * Tous les fournisseurs ne garantissent pas une sortie JSON stricte :
 * un modèle local (Ollama, vLLM) ou un modèle « raisonneur » (DeepSeek
 * R1) peut entourer l'objet de prose, de balises de code, d'un bloc
 * <think>…</think>, ou laisser traîner une virgule finale. On tolère
 * tout cela avant de conclure à l'échec.
 */

/** Retire les blocs de raisonnement et les balises de code. */
export function nettoyerReponse(texte: string): string {
  return texte
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<\/?think>/gi, "")
    .replace(/```[a-zA-Z0-9_-]*\s*/g, "")
    .trim();
}

/**
 * Renvoie la première structure JSON équilibrée (objet ou tableau) à
 * partir de `depuis`, en tenant compte des chaînes et des caractères
 * échappés, ou null.
 */
export function premierBlocEquilibre(texte: string, depuis = 0): string | null {
  const relatif = texte.slice(depuis).search(/[{[]/);
  if (relatif === -1) return null;
  const debut = depuis + relatif;
  const pile: string[] = [];
  let enChaine = false;
  let echappe = false;
  for (let i = debut; i < texte.length; i++) {
    const c = texte[i];
    if (enChaine) {
      if (echappe) echappe = false;
      else if (c === "\\") echappe = true;
      else if (c === '"') enChaine = false;
      continue;
    }
    if (c === '"') enChaine = true;
    else if (c === "{") pile.push("}");
    else if (c === "[") pile.push("]");
    else if (c === "}" || c === "]") {
      if (pile.pop() !== c) return null;
      if (pile.length === 0) return texte.slice(debut, i + 1);
    }
  }
  return null;
}

/** Réparations légères : virgules finales, guillemets typographiques hors chaînes. */
export function reparerJson(texte: string): string {
  return texte
    .replace(/,\s*([}\]])/g, "$1")
    .replace(/[“”]/g, '"');
}

function essayer(texte: string): unknown | null {
  try {
    return JSON.parse(texte);
  } catch {
    return null;
  }
}

/**
 * Extrait l'objet JSON d'une réponse LLM. Ordre des tentatives :
 * 1. texte nettoyé tel quel ;
 * 2. premier bloc équilibré ;
 * 3. du premier « { » au dernier « } » ;
 * puis chacune avec réparations légères. Renvoie null sinon.
 */
export function extraireJson(texte: string): unknown | null {
  if (typeof texte !== "string") return null;
  const nettoye = nettoyerReponse(texte);
  if (!nettoye) return null;

  const candidats: string[] = [nettoye];
  // Blocs équilibrés successifs : la prose peut contenir ses propres
  // accolades (« format {clé: valeur} ») avant le vrai objet.
  let depuis = 0;
  for (let n = 0; n < 20; n++) {
    const relatif = nettoye.slice(depuis).search(/[{[]/);
    if (relatif === -1) break;
    const bloc = premierBlocEquilibre(nettoye, depuis + relatif);
    if (bloc) candidats.push(bloc);
    depuis = depuis + relatif + 1;
  }
  const debut = nettoye.indexOf("{");
  const fin = nettoye.lastIndexOf("}");
  if (debut !== -1 && fin > debut) candidats.push(nettoye.slice(debut, fin + 1));

  for (const candidat of candidats) {
    const direct = essayer(candidat);
    if (direct !== null && typeof direct === "object") return direct;
  }
  for (const candidat of candidats) {
    const repare = essayer(reparerJson(candidat));
    if (repare !== null && typeof repare === "object") return repare;
  }
  return null;
}

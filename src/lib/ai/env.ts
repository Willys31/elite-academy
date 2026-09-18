/**
 * Lecture tolérante des variables d'environnement – logique pure.
 *
 * Dans `.env.local`, `LLM_PROVIDER="gemini"` est lu sans ses guillemets.
 * Dans le tableau de bord d'un hébergeur (Vercel…), les mêmes guillemets
 * sont conservés tels quels : la valeur devient `"gemini"`, n'est plus
 * reconnue, et l'application conclut à tort que l'IA n'est pas
 * configurée. Un espace ou un retour à la ligne collé en fin de clé
 * produit le même genre de panne silencieuse.
 *
 * On nettoie donc à la lecture plutôt que d'exiger une saisie parfaite.
 */
export function nettoyerValeurEnv(valeur: string | undefined | null): string {
  if (valeur === undefined || valeur === null) return "";
  let v = valeur.trim();
  const premier = v.charAt(0);
  if (
    v.length >= 2 &&
    (premier === '"' || premier === "'") &&
    v.charAt(v.length - 1) === premier
  ) {
    v = v.slice(1, -1).trim();
  }
  return v;
}

/** Valeur nettoyée d'une variable d'environnement ; chaîne vide si absente. */
export function lireEnv(nom: string): string {
  return nettoyerValeurEnv(process.env[nom]);
}

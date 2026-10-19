/**
 * Lecture minimale d'un fichier `.env.local` — logique pure, testée.
 * Gère : commentaires, lignes vides, `export NOM=valeur`, guillemets
 * simples ou doubles, espaces autour du `=`. Pas d'interpolation.
 */
export function analyserDotenv(texte: string): Record<string, string> {
  const valeurs: Record<string, string> = {};
  for (const brute of texte.split(/\r?\n/)) {
    const ligne = brute.trim();
    if (!ligne || ligne.startsWith("#")) continue;
    const m = ligne.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let valeur = m[2].trim();
    const premier = valeur.charAt(0);
    if ((premier === '"' || premier === "'") && valeur.length >= 2 && valeur.endsWith(premier)) {
      valeur = valeur.slice(1, -1);
    } else {
      // Commentaire en fin de ligne (précédé d'un espace).
      const i = valeur.search(/\s#/);
      if (i !== -1) valeur = valeur.slice(0, i).trim();
    }
    valeurs[m[1]] = valeur;
  }
  return valeurs;
}

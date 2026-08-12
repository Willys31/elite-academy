/**
 * Certificats – logique pure, testable.
 * Codes de vérification lisibles et libellés français.
 */

/** Même alphabet non ambigu que les codes de session. */
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const BLOCS = 3;
const TAILLE_BLOC = 4;

/**
 * Génère un code de vérification lisible : EA-XXXX-XXXX-XXXX.
 * La source aléatoire est injectable pour les tests.
 */
export function genererCodeVerification(
  aleatoire: () => number = Math.random
): string {
  const blocs: string[] = [];
  for (let b = 0; b < BLOCS; b++) {
    let bloc = "";
    for (let i = 0; i < TAILLE_BLOC; i++) {
      const index = Math.floor(aleatoire() * ALPHABET.length);
      bloc += ALPHABET[Math.min(index, ALPHABET.length - 1)];
    }
    blocs.push(bloc);
  }
  return `EA-${blocs.join("-")}`;
}

/** Normalise une saisie (espaces, minuscules). */
export function normaliserCodeVerification(saisie: string): string {
  return saisie.trim().toUpperCase().replace(/\s+/g, "");
}

/** Le code a-t-il le format attendu EA-XXXX-XXXX-XXXX ? */
export function codeVerificationValide(code: string): boolean {
  const c = normaliserCodeVerification(code);
  const motif = new RegExp(
    `^EA(-[${ALPHABET}]{${TAILLE_BLOC}}){${BLOCS}}$`
  );
  return motif.test(c);
}

export const CERT_TYPE_LABELS: Record<string, string> = {
  participation: "Attestation de participation",
  completion: "Attestation de complétion",
  success: "Certificat de réussite",
  skill: "Preuve de compétence",
};

export const CERT_STATUS_LABELS: Record<string, string> = {
  valid: "Valide",
  revoked: "Révoqué",
};

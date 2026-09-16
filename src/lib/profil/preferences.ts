/**
 * Préférences personnelles – logique pure, testable.
 *
 * Elles vivent dans `profiles.preferences` (jsonb, migration 0001), une
 * colonne prévue dès le socle et restée vide jusqu'ici. Chaque lot y
 * ajoute sa clé ; ce module garantit des valeurs par défaut cohérentes
 * quelle que soit la forme du JSON stocké (absent, partiel, corrompu).
 *
 * Défauts choisis :
 * - classement visible : oui — l'apprenant peut se retirer (opt-out) ;
 * - entraide : non — l'apprenant doit l'activer (opt-in, addendum
 *   Entraide §2).
 */

export interface PreferencesClassement {
  /** Apparaître dans les classements de ses formations. */
  visible: boolean;
  /** Nom d'affichage dans les classements ; null = nom réel. */
  pseudo: string | null;
}

export interface PreferencesEntraide {
  actif: boolean;
  /** Date d'activation (ISO), pour information. */
  depuis: string | null;
}

export interface Preferences {
  classement: PreferencesClassement;
  entraide: PreferencesEntraide;
}

export const PREFERENCES_PAR_DEFAUT: Preferences = {
  classement: { visible: true, pseudo: null },
  entraide: { actif: false, depuis: null },
};

export const PSEUDO_MIN = 2;
export const PSEUDO_MAX = 30;

function objet(valeur: unknown): Record<string, unknown> {
  return valeur !== null && typeof valeur === "object" && !Array.isArray(valeur)
    ? (valeur as Record<string, unknown>)
    : {};
}

/** Lit le JSON stocké en tolérant les formes incomplètes. */
export function lirePreferences(brut: unknown): Preferences {
  const racine = objet(brut);
  const classement = objet(racine.classement);
  const entraide = objet(racine.entraide);

  const pseudo =
    typeof classement.pseudo === "string" && classement.pseudo.trim().length >= PSEUDO_MIN
      ? classement.pseudo.trim().slice(0, PSEUDO_MAX)
      : null;

  return {
    classement: {
      visible:
        typeof classement.visible === "boolean"
          ? classement.visible
          : PREFERENCES_PAR_DEFAUT.classement.visible,
      pseudo,
    },
    entraide: {
      actif:
        typeof entraide.actif === "boolean"
          ? entraide.actif
          : PREFERENCES_PAR_DEFAUT.entraide.actif,
      depuis: typeof entraide.depuis === "string" ? entraide.depuis : null,
    },
  };
}

/**
 * Fusionne une modification partielle dans le JSON existant, sans
 * écraser les clés d'autres lots (les clés inconnues sont conservées).
 */
export function fusionnerPreferences(
  existant: unknown,
  patch: Partial<{ [K in keyof Preferences]: Partial<Preferences[K]> }>
): Record<string, unknown> {
  const racine = objet(existant);
  const actuel = lirePreferences(existant);
  return {
    ...racine,
    classement: { ...actuel.classement, ...(patch.classement ?? {}) },
    entraide: { ...actuel.entraide, ...(patch.entraide ?? {}) },
  };
}

/** Validation d'un pseudo saisi : chaîne vide = retour au nom réel. */
export function validerPseudo(saisie: string): { ok: true; pseudo: string | null } | { ok: false; raison: string } {
  const propre = saisie.trim().replace(/\s+/g, " ");
  if (propre.length === 0) return { ok: true, pseudo: null };
  if (propre.length < PSEUDO_MIN) {
    return { ok: false, raison: `Le pseudo doit contenir au moins ${PSEUDO_MIN} caractères.` };
  }
  if (propre.length > PSEUDO_MAX) {
    return { ok: false, raison: `Le pseudo ne peut pas dépasser ${PSEUDO_MAX} caractères.` };
  }
  if (propre.includes("@")) {
    return { ok: false, raison: "Le pseudo ne doit pas ressembler à une adresse e-mail." };
  }
  return { ok: true, pseudo: propre };
}

/**
 * « Expliquer ce passage » — lot 28. Logique pure, testée.
 *
 * L'apprenant sélectionne (ou saisit) un mot ou une expression d'une
 * leçon ; le tuteur reçoit ce passage et son contexte dans la leçon,
 * pour expliquer fidèlement ce que dit le cours.
 */

export const PASSAGE_MIN = 2;
export const PASSAGE_MAX = 300;
/** Caractères de contexte transmis avant et après le passage. */
export const CONTEXTE_RAYON = 600;
/** Début de leçon transmis quand le passage n'y figure pas. */
export const CONTEXTE_SANS_PASSAGE = 1200;

/** Espaces normalisés, guillemets et ponctuation de bord retirés. */
export function nettoyerPassage(brut: unknown): string {
  if (typeof brut !== "string") return "";
  return brut
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[«"'“”‘’(\[\s]+/, "")
    .replace(/[»"'“”‘’)\]\s.,;:!?…]+$/, "")
    .trim();
}

export type ValidationPassage = { ok: true } | { ok: false; erreur: string };

export function passageValide(passage: string): ValidationPassage {
  if (passage.length < PASSAGE_MIN) return { ok: false, erreur: "Sélectionnez un mot ou une expression (au moins deux caractères)." };
  if (passage.length > PASSAGE_MAX) {
    return { ok: false, erreur: `Sélectionnez un passage plus court (${PASSAGE_MAX} caractères au plus) : un mot, une expression ou une phrase.` };
  }
  if (!/\p{L}|\p{N}/u.test(passage)) return { ok: false, erreur: "Sélectionnez un mot ou une expression." };
  return { ok: true };
}

/**
 * Normalisation caractère par caractère, SANS changer la longueur :
 * minuscule, accent retiré, tout blanc → espace. Les index de la
 * chaîne normalisée sont donc ceux du texte d'origine.
 */
function normaliser(texte: string): string {
  let r = "";
  for (const c of texte) {
    if (/\s/.test(c)) {
      r += " ";
      continue;
    }
    const base = c.normalize("NFD").replace(/\p{M}+/gu, "")[0] ?? c;
    // Un caractère qui se décompose en plusieurs (ligatures) garde sa place.
    r += base.toLowerCase().slice(0, 1) || c;
  }
  return r;
}

function echapperRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export interface ContextePassage {
  /** Le passage figure-t-il dans la leçon ? */
  trouve: boolean;
  /** Extrait transmis au tuteur (avec « … » aux coupures). */
  extrait: string;
}

/**
 * Extrait de la leçon autour du passage : recherche insensible à la
 * casse, aux accents et aux espaces multiples ; fenêtre de
 * `CONTEXTE_RAYON` caractères de part et d'autre, élargie au mot entier.
 * Passage introuvable : début de la leçon.
 */
export function extraireContexte(texteLecon: string, passage: string): ContextePassage {
  const texte = texteLecon ?? "";
  const p = nettoyerPassage(passage);
  if (texte && p) {
    const motif = normaliser(p)
      .split(" ")
      .filter(Boolean)
      .map(echapperRegex)
      .join("\\s+");
    const correspondance = new RegExp(motif, "u").exec(normaliser(texte));
    if (correspondance) {
      const debutPassage = correspondance.index;
      const finPassage = debutPassage + correspondance[0].length;
      let debut = Math.max(0, debutPassage - CONTEXTE_RAYON);
      let fin = Math.min(texte.length, finPassage + CONTEXTE_RAYON);
      // Élargir au mot entier, sans couper au milieu.
      while (debut > 0 && !/\s/.test(texte[debut - 1])) debut--;
      while (fin < texte.length && !/\s/.test(texte[fin])) fin++;
      const extrait = `${debut > 0 ? "…" : ""}${texte.slice(debut, fin).trim()}${fin < texte.length ? "…" : ""}`;
      return { trouve: true, extrait };
    }
  }
  const tronque = texte.length > CONTEXTE_SANS_PASSAGE;
  return { trouve: false, extrait: `${texte.slice(0, CONTEXTE_SANS_PASSAGE).trim()}${tronque ? "…" : ""}` };
}

/** Type d'aide du lot 28 dans `tutor_help_events.help_type`. */
export const TYPE_AIDE_PASSAGE = "explain_passage" as const;
export const LIBELLE_AIDE_PASSAGE = "Expliquer un passage";

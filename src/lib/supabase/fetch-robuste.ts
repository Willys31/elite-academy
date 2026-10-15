/**
 * `fetch` tolérant aux connexions variables (PRD §20 : « compatible
 * avec des connexions variables »).
 *
 * Constat du 15 octobre 2026 : sur un réseau instable, Node ouvre une
 * dizaine de connexions TLS vers Supabase pour rendre une page, et une
 * partie d'entre elles expire à l'établissement (`UND_ERR_CONNECT_TIMEOUT`,
 * 10 s) alors que les autres aboutissent en 100 ms. Une page tombait
 * alors en erreur ou mettait une minute à s'afficher, et la connexion
 * échouait avec « Une erreur est survenue ».
 *
 * Seules les défaillances survenues AVANT que la requête ne parte sont
 * rejouées : un délai ou un refus de connexion, une résolution DNS
 * ratée, une coupure pendant la négociation TLS. Rien n'a atteint le
 * serveur, le rejeu est donc sûr quel que soit le verbe HTTP (une
 * action serveur n'est jamais appliquée deux fois). Une réponse HTTP,
 * même 5xx, n'est jamais rejouée ici.
 */

const CODES_AVANT_ENVOI = new Set([
  "UND_ERR_CONNECT_TIMEOUT",
  "ECONNREFUSED",
  "ECONNRESET",
  "ENOTFOUND",
  "EAI_AGAIN",
  "ETIMEDOUT",
  "UND_ERR_SOCKET",
]);

const TENTATIVES = 3;
const PAUSE_MS = 300;

/**
 * Délai par essai sur les API de données et d'authentification. Node
 * n'abandonne une connexion qui n'aboutit pas qu'après 10 s : trois
 * essais feraient attendre 30 s. Une requête REST ou Auth qui aboutit
 * répond en quelques centaines de millisecondes ; au-delà de 6 s, on
 * coupe et on rejoue. Storage (téléchargement d'un document de
 * 100 Mo pour l'import) n'est jamais chronométré.
 */
const DELAI_ESSAI_MS = 6000;

function chronometrable(entree: RequestInfo | URL, init?: RequestInit): boolean {
  if (init?.signal) return false; // l'appelant gère déjà son délai
  const url = typeof entree === "string" ? entree : entree instanceof URL ? entree.href : "";
  return url.includes("/rest/v1/") || url.includes("/auth/v1/");
}

function codeDe(erreur: unknown): string | null {
  if (!erreur || typeof erreur !== "object") return null;
  const e = erreur as { code?: unknown; cause?: unknown };
  if (typeof e.code === "string") return e.code;
  if (e.cause && typeof e.cause === "object") {
    const c = (e.cause as { code?: unknown }).code;
    if (typeof c === "string") return c;
  }
  return null;
}

/** L'erreur est-elle survenue avant tout envoi au serveur ? */
export function erreurAvantEnvoi(erreur: unknown): boolean {
  const code = codeDe(erreur);
  if (code && CODES_AVANT_ENVOI.has(code)) return true;
  // `ECONNRESET` pendant la négociation TLS arrive parfois sans code,
  // sous la forme d'un message « fetch failed » avec une cause socket.
  const cause = (erreur as { cause?: { code?: string } } | null)?.cause;
  return Boolean(cause?.code && CODES_AVANT_ENVOI.has(cause.code));
}

/**
 * Même signature que `fetch`. Le corps d'une requête `Request` ne peut
 * être relu qu'une fois : on ne rejoue que les appels à partir d'une
 * URL et d'options (ce que fait supabase-js).
 */
export const fetchRobuste: typeof fetch = async (entree, init) => {
  let derniere: unknown;
  const avecDelai = chronometrable(entree, init);
  for (let essai = 1; essai <= TENTATIVES; essai++) {
    const controleur = avecDelai ? new AbortController() : null;
    const minuterie = controleur
      ? setTimeout(() => controleur.abort(new Error("delai-essai")), DELAI_ESSAI_MS)
      : null;
    try {
      return await fetch(entree, controleur ? { ...init, signal: controleur.signal } : init);
    } catch (erreur) {
      derniere = erreur;
      const coupeParNous = Boolean(controleur?.signal.aborted);
      const rejouable = (coupeParNous || erreurAvantEnvoi(erreur)) && !(entree instanceof Request);
      if (!rejouable || essai === TENTATIVES) throw erreur;
      await new Promise((r) => setTimeout(r, PAUSE_MS * essai));
    } finally {
      if (minuterie) clearTimeout(minuterie);
    }
  }
  throw derniere;
};

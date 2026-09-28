/**
 * Visio et mode hybride (lot 19) – logique pure, testable.
 *
 * Une session se tient sur place, en visio (Google Meet) ou les deux.
 * Chaque participant a un canal : sur place (code / QR code) ou à
 * distance (bouton « Rejoindre la visio »).
 *
 * La présence en visio est reprise de l'API Google Meet : les
 * participants de la conférence sont rapprochés des inscrits de la
 * session par leur nom affiché, avec les mêmes règles que les locuteurs
 * d'une transcription (nom complet, ou prénom seul s'il est unique).
 */

import { rapprocherLocuteurs, type PersonneRapprochable } from "@/lib/sessions/tldv";

export const MODES_SESSION = ["onsite", "remote", "hybrid"] as const;
export type ModeSession = (typeof MODES_SESSION)[number];
export type CanalParticipant = "onsite" | "remote";

export const MODE_LABELS: Record<ModeSession, string> = {
  onsite: "Présentiel",
  remote: "Visio",
  hybrid: "Hybride",
};

export const MODE_DESCRIPTIONS: Record<ModeSession, string> = {
  onsite: "Tout le monde est dans la salle et rejoint par code ou QR code.",
  remote: "Tout le monde suit à distance sur Google Meet.",
  hybrid: "Une partie du groupe est sur place, l'autre suit sur Google Meet.",
};

export function lireMode(valeur: unknown): ModeSession {
  return MODES_SESSION.includes(valeur as ModeSession) ? (valeur as ModeSession) : "onsite";
}

export function modeAvecVisio(mode: string | null | undefined): boolean {
  return mode === "remote" || mode === "hybrid";
}

/** Code de réunion Meet : trois groupes de lettres, ex. abc-defg-hij. */
const CODE_MEET = /^[a-z]{3}-[a-z]{4}-[a-z]{3}$/;

/**
 * Lit un lien Google Meet collé par le formateur (avec ou sans
 * `https://`, avec paramètres) ou un code seul. Renvoie le lien
 * canonique et le code, ou null si ce n'est pas un lien Meet.
 */
export function lireLienMeet(saisie: string): { uri: string; code: string } | null {
  const brut = saisie.trim().toLowerCase();
  if (!brut) return null;
  if (CODE_MEET.test(brut)) return { uri: `https://meet.google.com/${brut}`, code: brut };
  let url: URL;
  try {
    url = new URL(/^https?:\/\//.test(brut) ? brut : `https://${brut}`);
  } catch {
    return null;
  }
  if (url.hostname !== "meet.google.com") return null;
  const code = url.pathname.replace(/^\/+|\/+$/g, "");
  if (!CODE_MEET.test(code)) return null;
  return { uri: `https://meet.google.com/${code}`, code };
}

// ------------------------------------------------------------
// Présence reprise de Google Meet
// ------------------------------------------------------------

/** Participant d'une conférence, tel que renvoyé par l'API Meet (normalisé). */
export interface ParticipantMeet {
  nom: string;
  /** Première arrivée (ISO). */
  debut: string;
  /** Dernier départ (ISO) ; null s'il est encore dans la réunion. */
  fin: string | null;
}

/** Participant de la session à rapprocher. */
export interface InscritSession extends PersonneRapprochable {
  participantId: string;
  canal: CanalParticipant;
}

export interface PresenceMeet {
  participantId: string;
  arrivee: string;
  /** null = resté jusqu'à la clôture. */
  depart: string | null;
}

export interface ResultatRapprochementMeet {
  presences: PresenceMeet[];
  /** Noms vus dans Meet sans correspondance (ni formateur ni inscrit). */
  nonReconnus: string[];
  /** Fenêtre réelle de la visio : première arrivée, dernier départ. */
  debutVisio: string | null;
  finVisio: string | null;
}

const t = (iso: string | null) => (iso ? new Date(iso).getTime() : NaN);

/**
 * Regroupe les passages d'un même nom (une personne peut se reconnecter,
 * y compris dans plusieurs conférences du même espace) : première
 * arrivée, dernier départ, null si l'un des passages est encore ouvert.
 */
export function fusionnerPassages(participants: ParticipantMeet[]): ParticipantMeet[] {
  const parNom = new Map<string, ParticipantMeet>();
  for (const p of participants) {
    const cle = p.nom.trim();
    if (!cle || !Number.isFinite(t(p.debut))) continue;
    const actuel = parNom.get(cle);
    if (!actuel) {
      parNom.set(cle, { nom: cle, debut: p.debut, fin: p.fin });
      continue;
    }
    const debut = t(p.debut) < t(actuel.debut) ? p.debut : actuel.debut;
    const fin = actuel.fin === null || p.fin === null ? null : t(p.fin) > t(actuel.fin) ? p.fin : actuel.fin;
    parNom.set(cle, { nom: cle, debut, fin });
  }
  return [...parNom.values()];
}

/**
 * Calcule, pour chaque inscrit à distance reconnu dans Meet, l'arrivée
 * et le départ à retenir pour le calcul de présence.
 *
 * - Les inscrits « sur place » ne sont jamais modifiés : leur présence
 *   vient du code saisi dans la salle.
 * - Un départ postérieur ou égal à la clôture vaut « resté jusqu'au
 *   bout » (null), comme un participant encore connecté.
 */
export function rapprocherPresencesMeet(
  participantsMeet: ParticipantMeet[],
  inscrits: InscritSession[],
  formateur: PersonneRapprochable | null,
  cloture: string | null
): ResultatRapprochementMeet {
  const passages = fusionnerPassages(participantsMeet);
  const rapprochements = rapprocherLocuteurs(
    passages.map((p) => p.nom),
    inscrits,
    formateur
  );
  const parNom = new Map(rapprochements.map((r) => [r.locuteur, r]));
  const parUser = new Map(inscrits.map((i) => [i.userId, i]));
  const finCloture = t(cloture);

  const presences: PresenceMeet[] = [];
  const nonReconnus: string[] = [];
  for (const p of passages) {
    const r = parNom.get(p.nom);
    if (!r || !r.userId) {
      nonReconnus.push(p.nom);
      continue;
    }
    if (r.type !== "learner") continue;
    const inscrit = parUser.get(r.userId);
    if (!inscrit || inscrit.canal !== "remote") continue;
    const resteJusquauBout = p.fin === null || (Number.isFinite(finCloture) && t(p.fin) >= finCloture);
    presences.push({
      participantId: inscrit.participantId,
      arrivee: p.debut,
      depart: resteJusquauBout ? null : p.fin,
    });
  }

  const debuts = passages.map((p) => t(p.debut)).filter(Number.isFinite);
  const finsConnues = passages.map((p) => t(p.fin)).filter(Number.isFinite);
  const encoreOuverte = passages.some((p) => p.fin === null);
  return {
    presences,
    nonReconnus: nonReconnus.sort((a, b) => a.localeCompare(b, "fr")),
    debutVisio: debuts.length > 0 ? new Date(Math.min(...debuts)).toISOString() : null,
    finVisio:
      encoreOuverte || finsConnues.length === 0 ? null : new Date(Math.max(...finsConnues)).toISOString(),
  };
}

/** Durée en minutes entre deux instants ISO ; null si l'un manque. */
export function dureeMinutes(debut: string | null, fin: string | null): number | null {
  if (!Number.isFinite(t(debut)) || !Number.isFinite(t(fin))) return null;
  return Math.max(0, Math.round((t(fin) - t(debut)) / 60_000));
}

/** « 1 h 05 », « 45 min ». */
export function formaterDuree(minutes: number | null): string {
  if (minutes === null) return "—";
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h} h ${String(m).padStart(2, "0")}`;
}

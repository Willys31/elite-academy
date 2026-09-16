/**
 * Transcriptions (tl;dv ou import manuel) – logique pure, testable.
 *
 * tl;dv n'est pas intégré par clé API (aucune clé disponible) : on
 * accepte sa charge utile par webhook, dans plusieurs formes possibles,
 * et on sait aussi lire une transcription collée ou importée à la main.
 */

export interface SegmentTranscription {
  locuteur: string;
  /** Secondes depuis le début ; null si inconnu. */
  debut: number | null;
  fin: number | null;
  texte: string;
}

export interface ChargeTldv {
  meetingId: string;
  transcriptId: string;
  titre: string | null;
  texte: string;
  segments: SegmentTranscription[];
}

function chaine(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : typeof v === "number" ? String(v) : null;
}

function nombre(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() && Number.isFinite(Number(v))) return Number(v);
  return null;
}

function segmentDepuis(brut: unknown): SegmentTranscription | null {
  if (!brut || typeof brut !== "object") return null;
  const o = brut as Record<string, unknown>;
  const texte = chaine(o.text ?? o.texte ?? o.content);
  if (!texte) return null;
  return {
    locuteur: chaine(o.speaker ?? o.speaker_name ?? o.locuteur ?? o.name) ?? "Inconnu",
    debut: nombre(o.start_time ?? o.start ?? o.debut ?? o.from),
    fin: nombre(o.end_time ?? o.end ?? o.fin ?? o.to),
    texte,
  };
}

/**
 * Normalise la charge d'un webhook tl;dv. Trois formes tolérées :
 * 1. `{ meeting_id, transcript_id?, transcript: "texte brut" }`
 * 2. `{ meeting_id, transcript_id?, segments: [{speaker, start_time, end_time, text}] }`
 * 3. `{ meeting: { id }, transcript: { id, data: [...] } }`
 * Renvoie null si l'identifiant de réunion ou le texte manquent.
 */
export function normaliserChargeTldv(json: unknown): ChargeTldv | null {
  if (!json || typeof json !== "object") return null;
  const o = json as Record<string, unknown>;
  const meeting = (o.meeting && typeof o.meeting === "object" ? (o.meeting as Record<string, unknown>) : null);
  const transcript =
    o.transcript && typeof o.transcript === "object" ? (o.transcript as Record<string, unknown>) : null;

  const meetingId =
    chaine(o.meeting_id ?? o.meetingId) ?? (meeting ? chaine(meeting.id ?? meeting.meeting_id) : null);
  if (!meetingId) return null;

  const transcriptId =
    chaine(o.transcript_id ?? o.transcriptId) ?? (transcript ? chaine(transcript.id) : null) ?? `meeting:${meetingId}`;
  const titre = chaine(o.title ?? o.titre) ?? (meeting ? chaine(meeting.name ?? meeting.title) : null);

  const brutsSegments =
    (Array.isArray(o.segments) && o.segments) ||
    (transcript && Array.isArray(transcript.data) && transcript.data) ||
    (transcript && Array.isArray(transcript.segments) && transcript.segments) ||
    [];
  const segments = brutsSegments.map(segmentDepuis).filter((s): s is SegmentTranscription => Boolean(s));

  const texteBrut =
    (typeof o.transcript === "string" ? o.transcript : null) ??
    chaine(o.text ?? o.transcript_text) ??
    (transcript ? chaine(transcript.text) : null);

  const texte = texteBrut ?? (segments.length > 0 ? reconstituerTexte(segments) : null);
  if (!texte) return null;

  return { meetingId, transcriptId, titre, texte, segments };
}

/** `[hh:mm:ss] Nom : texte`, `Nom (mm:ss): texte` ou `Nom : texte`. */
const LIGNE_HORODATEE = /^\[(\d{1,2}):(\d{2})(?::(\d{2}))?\]\s*([^:]{1,60}?)\s*:\s*(.+)$/;
const LIGNE_PARENTHESE = /^([^:(]{1,60}?)\s*\((\d{1,2}):(\d{2})(?::(\d{2}))?\)\s*:\s*(.+)$/;
const LIGNE_SIMPLE = /^([A-Za-zÀ-ÿ' .-]{2,40}?)\s*:\s*(.+)$/;

function secondes(h: string, m: string, s?: string): number {
  return s !== undefined ? Number(h) * 3600 + Number(m) * 60 + Number(s) : Number(h) * 60 + Number(m);
}

/**
 * Parse une transcription collée à la main. Les lignes sans locuteur
 * sont rattachées au segment précédent (ou à « Inconnu »).
 */
export function parserTranscriptTexte(texte: string): SegmentTranscription[] {
  const segments: SegmentTranscription[] = [];
  for (const brute of texte.replace(/\r\n?/g, "\n").split("\n")) {
    const ligne = brute.trim();
    if (!ligne) continue;
    let m = ligne.match(LIGNE_HORODATEE);
    if (m) {
      segments.push({ locuteur: m[4].trim(), debut: secondes(m[1], m[2], m[3]), fin: null, texte: m[5].trim() });
      continue;
    }
    m = ligne.match(LIGNE_PARENTHESE);
    if (m) {
      segments.push({ locuteur: m[1].trim(), debut: secondes(m[2], m[3], m[4]), fin: null, texte: m[5].trim() });
      continue;
    }
    m = ligne.match(LIGNE_SIMPLE);
    if (m) {
      segments.push({ locuteur: m[1].trim(), debut: null, fin: null, texte: m[2].trim() });
      continue;
    }
    const dernier = segments[segments.length - 1];
    if (dernier) dernier.texte += ` ${ligne}`;
    else segments.push({ locuteur: "Inconnu", debut: null, fin: null, texte: ligne });
  }
  // Fin d'un segment = début du suivant, quand les deux sont horodatés.
  for (let i = 0; i < segments.length - 1; i++) {
    if (segments[i].fin === null && segments[i].debut !== null && segments[i + 1].debut !== null) {
      segments[i].fin = segments[i + 1].debut;
    }
  }
  return segments;
}

export function reconstituerTexte(segments: SegmentTranscription[]): string {
  return segments.map((s) => `${s.locuteur} : ${s.texte}`).join("\n");
}

export interface StatLocuteur {
  locuteur: string;
  nbInterventions: number;
  /** Mots prononcés — mesure robuste même sans horodatage. */
  nbMots: number;
  partMots: number;
}

export function statistiquesLocuteurs(segments: SegmentTranscription[]): StatLocuteur[] {
  const parLocuteur = new Map<string, { n: number; mots: number }>();
  let total = 0;
  for (const s of segments) {
    const mots = s.texte.split(/\s+/).filter(Boolean).length;
    total += mots;
    const actuel = parLocuteur.get(s.locuteur) ?? { n: 0, mots: 0 };
    parLocuteur.set(s.locuteur, { n: actuel.n + 1, mots: actuel.mots + mots });
  }
  return [...parLocuteur.entries()]
    .map(([locuteur, v]) => ({
      locuteur,
      nbInterventions: v.n,
      nbMots: v.mots,
      partMots: total === 0 ? 0 : Math.round((v.mots / total) * 100),
    }))
    .sort((a, b) => b.nbMots - a.nbMots);
}

function normaliser(texte: string): string {
  return texte
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export interface PersonneRapprochable {
  userId: string;
  fullName: string;
}

export interface Rapprochement {
  locuteur: string;
  userId: string | null;
  type: "trainer" | "learner" | "unknown";
}

/**
 * Associe chaque étiquette de locuteur à une personne connue : nom
 * complet (accents et casse ignorés), ou prénom seul s'il est unique.
 * Le formateur est reconnu en priorité ; « Formateur » / « Trainer »
 * lui sont attribués d'office.
 */
export function rapprocherLocuteurs(
  locuteurs: string[],
  participants: PersonneRapprochable[],
  formateur: PersonneRapprochable | null
): Rapprochement[] {
  const tous = [...(formateur ? [{ ...formateur, type: "trainer" as const }] : []), ...participants.map((p) => ({ ...p, type: "learner" as const }))];
  return [...new Set(locuteurs)].map((locuteur) => {
    const cle = normaliser(locuteur);
    if (formateur && /^(formateur|formatrice|trainer|animateur|animatrice)$/.test(cle)) {
      return { locuteur, userId: formateur.userId, type: "trainer" };
    }
    const exact = tous.find((p) => normaliser(p.fullName) === cle);
    if (exact) return { locuteur, userId: exact.userId, type: exact.type };
    const parPrenom = tous.filter((p) => normaliser(p.fullName).split(" ")[0] === cle);
    if (parPrenom.length === 1) return { locuteur, userId: parPrenom[0].userId, type: parPrenom[0].type };
    return { locuteur, userId: null, type: "unknown" };
  });
}

import "server-only";

import { createSign } from "node:crypto";
import { lireEnv } from "@/lib/ai/env";
import type { ParticipantMeet } from "@/lib/sessions/visio";

/**
 * Client Google Meet (API REST v2) – côté serveur uniquement.
 *
 * Authentification : compte de service Google Cloud avec délégation au
 * niveau du domaine (Google Workspace d'Elite), qui agit au nom d'un
 * compte organisateur (ex. formations@lelabodelite.com). Les salles sont
 * créées par ce compte ; le formateur et les apprenants les rejoignent
 * par le lien, sans validation à l'entrée (accès « ouvert »).
 *
 * Portée unique : `meetings.space.created` — créer des salles et lire
 * les conférences des salles créées par l'application, rien d'autre.
 *
 * Aucune dépendance : le jeton JWT est signé avec `node:crypto`.
 */

const PORTEE = "https://www.googleapis.com/auth/meetings.space.created";
const URL_JETON = "https://oauth2.googleapis.com/token";
const API = "https://meet.googleapis.com/v2";

interface ConfigMeet {
  email: string;
  cle: string;
  organisateur: string;
}

function config(): ConfigMeet | null {
  const email = lireEnv("GOOGLE_MEET_CLIENT_EMAIL");
  // Dans un tableau de bord d'hébergeur, les retours à la ligne de la
  // clé sont souvent saisis sous la forme littérale « \n ».
  const cle = lireEnv("GOOGLE_MEET_PRIVATE_KEY").replace(/\\n/g, "\n");
  const organisateur = lireEnv("GOOGLE_MEET_ORGANISATEUR");
  if (!email || !cle || !organisateur) return null;
  return { email, cle, organisateur };
}

/** Google Meet est-il configuré (création auto et présence) ? */
export function meetConfigure(): boolean {
  return config() !== null;
}

const base64url = (v: string | Buffer) => Buffer.from(v).toString("base64url");

let jetonEnCache: { valeur: string; expire: number } | null = null;

async function jeton(c: ConfigMeet): Promise<string> {
  if (jetonEnCache && jetonEnCache.expire > Date.now() + 60_000) return jetonEnCache.valeur;
  const maintenant = Math.floor(Date.now() / 1000);
  const entete = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const charge = base64url(
    JSON.stringify({
      iss: c.email,
      sub: c.organisateur,
      scope: PORTEE,
      aud: URL_JETON,
      iat: maintenant,
      exp: maintenant + 3600,
    })
  );
  const signature = createSign("RSA-SHA256").update(`${entete}.${charge}`).sign(c.cle).toString("base64url");
  const reponse = await fetch(URL_JETON, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${entete}.${charge}.${signature}`,
    }),
  });
  if (!reponse.ok) {
    throw new Error(`Authentification Google refusée (${reponse.status}) : ${(await reponse.text()).slice(0, 300)}`);
  }
  const json = (await reponse.json()) as { access_token: string; expires_in: number };
  jetonEnCache = { valeur: json.access_token, expire: Date.now() + json.expires_in * 1000 };
  return json.access_token;
}

async function appeler<T>(chemin: string, init: RequestInit = {}): Promise<T> {
  const c = config();
  if (!c) throw new Error("Google Meet n'est pas configuré (voir .env.example).");
  const reponse = await fetch(`${API}/${chemin}`, {
    ...init,
    headers: { ...(init.headers ?? {}), authorization: `Bearer ${await jeton(c)}`, "content-type": "application/json" },
  });
  if (!reponse.ok) {
    throw new Error(`API Google Meet (${reponse.status}) : ${(await reponse.text()).slice(0, 300)}`);
  }
  return (await reponse.json()) as T;
}

export interface SalleMeet {
  /** Identifiant de ressource, ex. `spaces/AbCdEf`. */
  name: string;
  meetingUri: string;
  meetingCode: string;
}

/** Crée une salle Meet ouverte : toute personne ayant le lien entre sans attendre. */
export async function creerSalleMeet(): Promise<SalleMeet> {
  return appeler<SalleMeet>("spaces", {
    method: "POST",
    body: JSON.stringify({ config: { accessType: "OPEN", entryPointAccess: "ALL" } }),
  });
}

interface ConferenceBrute {
  name: string;
  startTime?: string;
  endTime?: string;
}

interface ParticipantBrut {
  earliestStartTime?: string;
  latestEndTime?: string;
  signedinUser?: { displayName?: string };
  anonymousUser?: { displayName?: string };
  phoneUser?: { displayName?: string };
}

async function toutesLesPages<T>(chemin: string, cle: string): Promise<T[]> {
  const resultats: T[] = [];
  let page: string | undefined;
  for (let i = 0; i < 20; i++) {
    const sep = chemin.includes("?") ? "&" : "?";
    const json = await appeler<Record<string, unknown>>(
      `${chemin}${sep}pageSize=100${page ? `&pageToken=${encodeURIComponent(page)}` : ""}`
    );
    resultats.push(...((json[cle] as T[] | undefined) ?? []));
    page = json.nextPageToken as string | undefined;
    if (!page) break;
  }
  return resultats;
}

/**
 * Participants de toutes les conférences tenues dans une salle (une
 * salle peut être rouverte plusieurs fois). Les passages d'une même
 * personne sont fusionnés ensuite par `rapprocherPresencesMeet`.
 */
export async function participantsDeLaSalle(spaceName: string): Promise<ParticipantMeet[]> {
  const filtre = encodeURIComponent(`space.name = "${spaceName}"`);
  const conferences = await toutesLesPages<ConferenceBrute>(`conferenceRecords?filter=${filtre}`, "conferenceRecords");
  const participants: ParticipantMeet[] = [];
  for (const conf of conferences) {
    const bruts = await toutesLesPages<ParticipantBrut>(`${conf.name}/participants`, "participants");
    for (const p of bruts) {
      const nom = p.signedinUser?.displayName ?? p.anonymousUser?.displayName ?? p.phoneUser?.displayName;
      if (!nom || !p.earliestStartTime) continue;
      participants.push({ nom, debut: p.earliestStartTime, fin: p.latestEndTime ?? null });
    }
  }
  return participants;
}

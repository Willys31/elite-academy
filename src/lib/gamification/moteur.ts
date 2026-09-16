import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { emettreNotification, notifierEncadrementFormation } from "@/lib/notifications/emettre";
import {
  aChangeDeNiveau,
  libelleNiveau,
} from "@/lib/gamification/niveaux";
import {
  badgeParCle,
  cleObtention,
  compteursMaitrise,
  DISTINCTION_DECLENCHEE_PAR,
  evaluerBadges,
  type BadgeDefinition,
} from "@/lib/gamification/badges";
import {
  cleJourUtc,
  palierSerieAtteint,
  serieJours,
  XP_FIXES,
  type TypeXp,
} from "@/lib/gamification/xp";

/**
 * Moteur de gamification – côté serveur uniquement.
 *
 * Orchestre lecture des compteurs → règles pures (xp.ts, badges.ts,
 * niveaux.ts) → écriture via le client d'administration. Les tables
 * écrites ici n'ont aucune politique d'écriture utilisateur (migration
 * 0013) : c'est ce module, appelé depuis des actions serveur qui ont
 * déjà vérifié l'appelant, qui fait foi.
 *
 * Aucune fonction ne lève : une panne de gamification ne doit jamais
 * empêcher l'enregistrement d'une tentative ou d'une présence. Les
 * erreurs sont journalisées.
 */

type Admin = ReturnType<typeof createAdminClient>;

function loguer(operation: string, erreur: unknown) {
  if (erreur) console.error(`[gamification] ${operation}`, erreur);
}

function admin(): Admin | null {
  try {
    return createAdminClient();
  } catch (erreur) {
    loguer("client admin", erreur);
    return null;
  }
}

// ------------------------------------------------------------
// XP
// ------------------------------------------------------------

export interface EvenementXp {
  userId: string;
  organizationId: string;
  type: TypeXp;
  montant: number;
  /** Idempotence : une seule attribution par (utilisateur, type, référence). */
  referenceId?: string | null;
  courseId?: string | null;
  activityId?: string | null;
  sessionId?: string | null;
  details?: Record<string, unknown>;
}

/** Somme des XP d'un utilisateur (toutes formations). */
export async function totalXp(userId: string, client: Admin | null = admin()): Promise<number> {
  if (!client) return 0;
  const { data } = await client.from("xp_events").select("xp_amount").eq("user_id", userId);
  return (data ?? []).reduce((s, l) => s + Number(l.xp_amount), 0);
}

/**
 * Attribue des points. Renvoie le montant réellement crédité : 0 si la
 * référence a déjà été créditée (double envoi) ou en cas d'erreur.
 * Notifie le passage de niveau.
 */
export async function attribuerXp(evt: EvenementXp): Promise<number> {
  const client = admin();
  if (!client || evt.montant <= 0) return 0;

  const avant = await totalXp(evt.userId, client);

  const { error } = await client.from("xp_events").insert({
    user_id: evt.userId,
    organization_id: evt.organizationId,
    course_id: evt.courseId ?? null,
    activity_id: evt.activityId ?? null,
    session_id: evt.sessionId ?? null,
    xp_type: evt.type,
    xp_amount: Math.round(evt.montant),
    reference_id: evt.referenceId ?? null,
    details: evt.details ?? {},
  });
  if (error) {
    if (error.code !== "23505") loguer(`attribution ${evt.type}`, error);
    return 0;
  }

  const nouveau = aChangeDeNiveau(avant, avant + evt.montant);
  if (nouveau) {
    await emettreNotification({
      userId: evt.userId,
      organizationId: evt.organizationId,
      type: "niveau_atteint",
      title: `Niveau ${nouveau.niveau} atteint · ${nouveau.titre}`,
      body: libelleNiveau(nouveau),
      href: "/badges",
    });
  }
  return evt.montant;
}

// ------------------------------------------------------------
// Compteurs
// ------------------------------------------------------------

export async function lireCompteurs(userId: string, client: Admin | null = admin()): Promise<Record<string, number>> {
  if (!client) return {};
  const { data } = await client
    .from("badge_progress")
    .select("counter_key, current_value")
    .eq("user_id", userId);
  const compteurs: Record<string, number> = {};
  for (const l of data ?? []) compteurs[l.counter_key as string] = Number(l.current_value);
  return compteurs;
}

/** Remplace la valeur de compteurs (valeurs recalculées). */
export async function fixerCompteurs(
  userId: string,
  valeurs: Record<string, number>,
  client: Admin | null = admin()
): Promise<void> {
  if (!client) return;
  const lignes = Object.entries(valeurs).map(([counter_key, current_value]) => ({
    user_id: userId,
    counter_key,
    current_value: Math.max(0, Math.round(current_value)),
    updated_at: new Date().toISOString(),
  }));
  if (lignes.length === 0) return;
  const { error } = await client
    .from("badge_progress")
    .upsert(lignes, { onConflict: "user_id,counter_key" });
  loguer("compteurs", error);
}

/** Ajoute à des compteurs (valeurs cumulatives). */
export async function incrementerCompteurs(
  userId: string,
  increments: Record<string, number>,
  client: Admin | null = admin()
): Promise<Record<string, number>> {
  const actuels = await lireCompteurs(userId, client);
  const valeurs: Record<string, number> = {};
  for (const [cle, delta] of Object.entries(increments)) {
    if (!delta) continue;
    valeurs[cle] = (actuels[cle] ?? 0) + delta;
  }
  await fixerCompteurs(userId, valeurs, client);
  return { ...actuels, ...valeurs };
}

// ------------------------------------------------------------
// Badges
// ------------------------------------------------------------

async function idsBadges(
  cles: string[],
  client: Admin
): Promise<Map<string, string>> {
  const ids = new Map<string, string>();
  if (cles.length === 0) return ids;
  const { data } = await client.from("badges").select("id, badge_key").in("badge_key", cles);
  for (const b of data ?? []) ids.set(b.badge_key as string, b.id as string);

  // Auto-réparation : une clé du catalogue absente en base (migration
  // antérieure au badge) est insérée depuis la définition TypeScript.
  const manquantes = cles.filter((c) => !ids.has(c));
  for (const cle of manquantes) {
    const def = badgeParCle(cle);
    if (!def) continue;
    const { data: cree, error } = await client
      .from("badges")
      .upsert(
        {
          badge_key: def.key,
          family: def.famille,
          name: def.nom,
          description: def.description,
          counter_key: def.compteur,
          target_value: def.cible,
          tier: def.palier,
          is_special: def.special,
          context_kind: def.contexte,
          sort_order: def.ordre,
        },
        { onConflict: "badge_key" }
      )
      .select("id")
      .single();
    loguer(`catalogue (${cle})`, error);
    if (cree) ids.set(cle, cree.id as string);
  }
  return ids;
}

export async function badgesObtenus(userId: string, client: Admin | null = admin()): Promise<Set<string>> {
  if (!client) return new Set();
  const { data } = await client
    .from("learner_badges")
    .select("context_key, badge:badges(badge_key)")
    .eq("user_id", userId);
  const obtenus = new Set<string>();
  for (const l of data ?? []) {
    const b = Array.isArray(l.badge) ? l.badge[0] : l.badge;
    if (b?.badge_key) obtenus.add(cleObtention(b.badge_key as string, (l.context_key as string) ?? ""));
  }
  return obtenus;
}

/**
 * Décerne un badge (à compteur ou événementiel). Idempotent grâce à
 * l'unicité (user, badge, contexte). Crédite l'XP du badge, notifie, et
 * propose la distinction associée le cas échéant.
 */
export async function decernerBadge(
  userId: string,
  organizationId: string,
  cle: string,
  contextKey = "",
  contexte: Record<string, unknown> = {},
  client: Admin | null = admin()
): Promise<BadgeDefinition | null> {
  const def = badgeParCle(cle);
  if (!client || !def) return null;

  const ids = await idsBadges([cle], client);
  const badgeId = ids.get(cle);
  if (!badgeId) return null;

  const { error } = await client.from("learner_badges").insert({
    user_id: userId,
    badge_id: badgeId,
    organization_id: organizationId,
    context_key: contextKey,
    context: contexte,
  });
  if (error) {
    if (error.code !== "23505") loguer(`badge ${cle}`, error);
    return null;
  }

  await attribuerXp({
    userId,
    organizationId,
    type: "badge",
    montant: XP_FIXES.badge,
    referenceId: badgeId,
    courseId: typeof contexte.course_id === "string" ? contexte.course_id : null,
    details: { badge: cle, context_key: contextKey },
  });

  await emettreNotification({
    userId,
    organizationId,
    type: "badge_debloque",
    title: `Badge ${def.nom} débloqué`,
    body: def.description,
    href: "/badges",
  });

  const distinction = DISTINCTION_DECLENCHEE_PAR[cle];
  if (distinction) {
    await proposerDistinction({
      userId,
      organizationId,
      cle: distinction,
      criteres: { badge_declencheur: cle },
      proposedBy: null,
      courseId: typeof contexte.course_id === "string" ? contexte.course_id : null,
    });
  }
  return def;
}

/**
 * Évalue les badges à compteur et décerne les nouveaux. À appeler après
 * toute mise à jour de compteurs.
 */
export async function verifierBadges(
  userId: string,
  organizationId: string,
  compteursConnus?: Record<string, number>
): Promise<string[]> {
  const client = admin();
  if (!client) return [];
  const [compteurs, obtenus] = await Promise.all([
    compteursConnus ? Promise.resolve(compteursConnus) : lireCompteurs(userId, client),
    badgesObtenus(userId, client),
  ]);
  const nouveaux = evaluerBadges(compteurs, obtenus);
  const decernes: string[] = [];
  for (const n of nouveaux) {
    const def = await decernerBadge(userId, organizationId, n.key, n.contextKey, {}, client);
    if (def) decernes.push(def.key);
  }
  return decernes;
}

/** Recalcule les compteurs de maîtrise depuis `progress_records`. */
export async function recalculerMaitriseCompteurs(userId: string): Promise<Record<string, number>> {
  const client = admin();
  if (!client) return {};
  const { data } = await client
    .from("progress_records")
    .select("mastery_level, competency:competencies(domain)")
    .eq("user_id", userId)
    .not("competency_id", "is", null);
  const valeurs = compteursMaitrise(
    (data ?? []).map((l) => {
      const c = Array.isArray(l.competency) ? l.competency[0] : l.competency;
      return { mastery_level: l.mastery_level as string | null, domain: (c?.domain as string) ?? null };
    })
  );
  await fixerCompteurs(userId, valeurs, client);
  return valeurs;
}

/**
 * Met à jour la série de jours d'activité à partir des dates distinctes
 * du journal XP. Notifie et signale un palier franchi.
 */
export async function mettreAJourSerie(userId: string, organizationId: string): Promise<number> {
  const client = admin();
  if (!client) return 0;
  const [{ data }, compteurs] = await Promise.all([
    client
      .from("xp_events")
      .select("created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(2000),
    lireCompteurs(userId, client),
  ]);
  const jours = [...new Set((data ?? []).map((l) => cleJourUtc(l.created_at as string)))];
  const serie = serieJours(jours, cleJourUtc(new Date()));
  const avant = compteurs.serie_jours ?? 0;
  await fixerCompteurs(userId, { serie_jours: serie }, client);

  const palier = palierSerieAtteint(avant, serie);
  if (palier) {
    await emettreNotification({
      userId,
      organizationId,
      type: "serie_record",
      title: `${palier} jours d'affilée`,
      body: "Votre régularité paie : continuez sur cette lancée.",
      href: "/badges",
    });
  }
  return serie;
}

// ------------------------------------------------------------
// Distinctions
// ------------------------------------------------------------

/**
 * Crée une proposition de distinction à valider par un formateur, sauf
 * si une proposition ou une distinction existe déjà pour ce badge (et
 * ce contexte de formation).
 */
export async function proposerDistinction(params: {
  userId: string;
  organizationId: string;
  cle: string;
  criteres: Record<string, unknown>;
  proposedBy: string | null;
  courseId?: string | null;
  client?: Admin | null;
}): Promise<boolean> {
  const client = params.client ?? admin();
  const def = badgeParCle(params.cle);
  if (!client || !def || !def.special) return false;

  const ids = await idsBadges([params.cle], client);
  const badgeId = ids.get(params.cle);
  if (!badgeId) return false;

  let requete = client
    .from("special_mentions")
    .select("id", { count: "exact", head: true })
    .eq("user_id", params.userId)
    .eq("badge_id", badgeId)
    .in("status", ["pending", "validated"]);
  if (params.courseId) requete = requete.eq("course_id", params.courseId);
  const { count } = await requete;
  if ((count ?? 0) > 0) return false;

  const { error } = await client.from("special_mentions").insert({
    user_id: params.userId,
    organization_id: params.organizationId,
    badge_id: badgeId,
    course_id: params.courseId ?? null,
    proposed_by: params.proposedBy,
    criteria: params.criteres,
    status: "pending",
  });
  if (error) {
    loguer("proposition de distinction", error);
    return false;
  }

  if (params.courseId) {
    await notifierEncadrementFormation(params.courseId, {
      type: "distinction_proposee",
      title: `Distinction « ${def.nom} » à valider`,
      body: "Un apprenant remplit les conditions : validez ou refusez depuis l'écran Distinctions.",
      href: "/distinctions",
    }, params.proposedBy ?? undefined);
  }
  return true;
}

/**
 * Concrétise une distinction validée : badge spécial, XP, notification.
 * Le changement de statut de la mention est fait par l'action (client
 * utilisateur, sous RLS) ; ici, uniquement les effets.
 */
export async function concretiserDistinction(params: {
  userId: string;
  organizationId: string;
  badgeKey: string;
  mentionId: string;
  courseId?: string | null;
  commentaire?: string | null;
}): Promise<void> {
  const client = admin();
  const def = badgeParCle(params.badgeKey);
  if (!client || !def) return;

  const ids = await idsBadges([params.badgeKey], client);
  const badgeId = ids.get(params.badgeKey);
  if (!badgeId) return;

  const { error } = await client.from("learner_badges").insert({
    user_id: params.userId,
    badge_id: badgeId,
    organization_id: params.organizationId,
    context_key: params.courseId ?? "",
    context: { mention_id: params.mentionId, course_id: params.courseId ?? null },
  });
  if (error && error.code !== "23505") loguer("badge de distinction", error);

  await attribuerXp({
    userId: params.userId,
    organizationId: params.organizationId,
    type: "distinction",
    montant: XP_FIXES.distinction,
    referenceId: params.mentionId,
    courseId: params.courseId ?? null,
    details: { badge: params.badgeKey },
  });

  await emettreNotification({
    userId: params.userId,
    organizationId: params.organizationId,
    type: "distinction_validee",
    title: `Félicitations ! Vous recevez la distinction ${def.nom}`,
    body: params.commentaire || def.description,
    href: "/badges",
  });
}

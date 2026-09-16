import "server-only";

import type { createClient } from "@/lib/supabase/server";
import { niveauDepuisXp, type NiveauGlobal } from "@/lib/gamification/niveaux";
import {
  cleObtention,
  prochainBadge,
  type ProchainBadge,
} from "@/lib/gamification/badges";

/**
 * Résumé de gamification d'un apprenant, lu avec SON client (donc sous
 * RLS : chacun ne lit que ses points, compteurs et badges). Sert à
 * l'accueil, au profil et à l'écran des badges.
 */

type Client = Awaited<ReturnType<typeof createClient>>;

export interface BadgeObtenu {
  key: string;
  contextKey: string;
  earnedAt: string;
}

export interface ResumeGamification {
  xpTotal: number;
  niveau: NiveauGlobal;
  compteurs: Record<string, number>;
  obtenus: BadgeObtenu[];
  clesObtenues: Set<string>;
  prochain: ProchainBadge | null;
  serieJours: number;
}

export async function resumeGamification(
  supabase: Client,
  userId: string
): Promise<ResumeGamification> {
  const [{ data: xp }, { data: compteursBruts }, { data: badges }] = await Promise.all([
    supabase.from("xp_events").select("xp_amount").eq("user_id", userId),
    supabase.from("badge_progress").select("counter_key, current_value").eq("user_id", userId),
    supabase
      .from("learner_badges")
      .select("context_key, earned_at, badge:badges(badge_key)")
      .eq("user_id", userId)
      .order("earned_at", { ascending: false }),
  ]);

  const xpTotal = (xp ?? []).reduce((s, l) => s + Number(l.xp_amount), 0);
  const compteurs: Record<string, number> = {};
  for (const c of compteursBruts ?? []) compteurs[c.counter_key as string] = Number(c.current_value);

  const obtenus: BadgeObtenu[] = [];
  for (const b of badges ?? []) {
    const def = Array.isArray(b.badge) ? b.badge[0] : b.badge;
    if (!def?.badge_key) continue;
    obtenus.push({
      key: def.badge_key as string,
      contextKey: (b.context_key as string) ?? "",
      earnedAt: b.earned_at as string,
    });
  }
  const clesObtenues = new Set(obtenus.map((b) => cleObtention(b.key, b.contextKey)));

  return {
    xpTotal,
    niveau: niveauDepuisXp(xpTotal),
    compteurs,
    obtenus,
    clesObtenues,
    prochain: prochainBadge(compteurs, clesObtenues),
    serieJours: compteurs.serie_jours ?? 0,
  };
}

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { QUOTA_DEFAUT_OCTETS, VALIDITE_PENDING_HEURES } from "@/lib/stockage/limites";

export interface UsageStockage {
  usage: number;
  quota: number;
}

/**
 * Usage et quota d'une organisation, lus avec les droits de l'appelant
 * (`organization_storage_usage` refuse un non-membre, migration 0018).
 */
export async function lireUsageStockage(
  supabase: SupabaseClient,
  organizationId: string
): Promise<UsageStockage> {
  const [{ data: usage }, { data: org }] = await Promise.all([
    supabase.rpc("organization_storage_usage", { org_id: organizationId }),
    supabase
      .from("organizations")
      .select("storage_quota_bytes")
      .eq("id", organizationId)
      .maybeSingle(),
  ]);
  return {
    usage: Number(usage ?? 0),
    quota: Number(org?.storage_quota_bytes ?? QUOTA_DEFAUT_OCTETS),
  };
}

/** Même lecture pour plusieurs organisations (pages de synthèse). */
export async function lireUsagesStockage(
  supabase: SupabaseClient,
  organizationIds: string[]
): Promise<Map<string, UsageStockage>> {
  const entrees = await Promise.all(
    organizationIds.map(async (id) => [id, await lireUsageStockage(supabase, id)] as const)
  );
  return new Map(entrees);
}

/**
 * Supprime les téléversements commencés il y a plus de 24 h et jamais
 * finalisés : la ligne `sources` et, s'il existe, l'objet partiel.
 * Client d'administration (les lignes peuvent appartenir à d'autres
 * concepteurs), au plus 50 lignes par passage. Appelée uniquement
 * depuis des actions serveur qui ont déjà vérifié l'appelant.
 */
export async function purgerTeleversementsAbandonnes(
  organizationId?: string
): Promise<{ purges: number }> {
  const admin = createAdminClient();
  const limite = new Date(Date.now() - VALIDITE_PENDING_HEURES * 3600 * 1000).toISOString();

  let requete = admin
    .from("sources")
    .select("id, file_path")
    .eq("upload_status", "pending")
    .lt("created_at", limite)
    .limit(50);
  if (organizationId) requete = requete.eq("organization_id", organizationId);

  const { data: abandonnes, error } = await requete;
  if (error || !abandonnes || abandonnes.length === 0) return { purges: 0 };

  const chemins = abandonnes.map((s) => s.file_path).filter(Boolean);
  if (chemins.length > 0) {
    const { error: erreurStockage } = await admin.storage.from("supports").remove(chemins);
    if (erreurStockage) console.error("[stockage] purge des objets :", erreurStockage.message);
  }

  const { error: erreurLignes } = await admin
    .from("sources")
    .delete()
    .in("id", abandonnes.map((s) => s.id));
  if (erreurLignes) console.error("[stockage] purge des lignes :", erreurLignes.message);

  return { purges: abandonnes.length };
}

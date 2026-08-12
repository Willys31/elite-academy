import "server-only";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/**
 * Client d'administration Supabase (clé service_role).
 *
 * STRICTEMENT côté serveur : l'import de "server-only" fait échouer
 * la compilation si ce module est importé depuis du code client.
 *
 * À n'utiliser que dans des actions serveur qui vérifient elles-mêmes
 * l'identité, le rôle et l'organisation de l'appelant avant d'agir.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    throw new Error(
      "Configuration serveur incomplète : SUPABASE_SERVICE_ROLE_KEY manquante."
    );
  }

  return createSupabaseClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

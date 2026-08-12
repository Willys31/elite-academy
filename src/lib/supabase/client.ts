"use client";

import { createBrowserClient } from "@supabase/ssr";

/**
 * Client Supabase côté navigateur.
 * Utilise uniquement l'URL publique et la clé anon (protégée par RLS).
 * Aucune clé secrète ne doit jamais transiter par ce fichier.
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

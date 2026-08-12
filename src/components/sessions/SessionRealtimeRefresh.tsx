"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/**
 * Abonnement temps réel d'une session : présences, événements et
 * état de la session. À chaque changement, la page (rendue côté
 * serveur, donc filtrée par RLS) est rafraîchie.
 *
 * En cas de coupure réseau, Supabase Realtime retente la connexion ;
 * un rafraîchissement est aussi déclenché à la reconnexion pour
 * rattraper les événements manqués.
 */
export function SessionRealtimeRefresh({ sessionId }: { sessionId: string }) {
  const router = useRouter();

  useEffect(() => {
    const supabase = createClient();
    const rafraichir = () => router.refresh();

    const canal = supabase
      .channel(`session-${sessionId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "session_participants",
          filter: `session_id=eq.${sessionId}`,
        },
        rafraichir
      )
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "live_events",
          filter: `session_id=eq.${sessionId}`,
        },
        rafraichir
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "live_sessions",
          filter: `id=eq.${sessionId}`,
        },
        rafraichir
      )
      .subscribe();

    // Rattrapage à la reconnexion réseau.
    const surReconnexion = () => rafraichir();
    window.addEventListener("online", surReconnexion);

    return () => {
      window.removeEventListener("online", surReconnexion);
      supabase.removeChannel(canal);
    };
  }, [sessionId, router]);

  return null;
}

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/profile";
import { bilanEnCsv, type LigneBilanParticipant } from "@/lib/sessions/analyse";
import type { Ponctualite, StatutPresence } from "@/lib/sessions/presence";

/**
 * Export CSV du bilan (addendum Sessions §8.2), réservé à l'encadrement
 * de la session (`oversees_session`). Les données sont lues avec le
 * client de l'utilisateur, donc sous RLS.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "non connecté" }, { status: 401 });

  const supabase = await createClient();
  const { data: session } = await supabase
    .from("live_sessions")
    .select("id, title")
    .eq("id", id)
    .maybeSingle();
  if (!session) return NextResponse.json({ error: "session introuvable" }, { status: 404 });

  const { data: encadrement } = await supabase.rpc("oversees_session", { sid: session.id });
  if (!encadrement) return NextResponse.json({ error: "droits insuffisants" }, { status: 403 });

  const [{ data: participants }, { data: feedbacks }, { data: tentatives }] = await Promise.all([
    supabase
      .from("session_participants")
      .select("user_id, presence_status, punctuality_status, presence_seconds, xp_awarded, profile:profiles(full_name, email)")
      .eq("session_id", session.id)
      .order("joined_at"),
    supabase.from("session_feedbacks").select("satisfaction_score, clarity_score, usefulness_score").eq("session_id", session.id),
    supabase.from("attempts").select("user_id, score").eq("session_id", session.id),
  ]);

  const parUser = new Map<string, number[]>();
  for (const t of tentatives ?? []) {
    if (t.score === null) continue;
    parUser.set(t.user_id as string, [...(parUser.get(t.user_id as string) ?? []), Number(t.score)]);
  }

  const lignes: LigneBilanParticipant[] = (participants ?? []).map((p) => {
    const profil = Array.isArray(p.profile) ? p.profile[0] : p.profile;
    const scores = parUser.get(p.user_id as string) ?? [];
    return {
      nom: (profil?.full_name as string) || (profil?.email as string) || "Participant",
      presence: p.presence_status
        ? {
            statut: p.presence_status as StatutPresence,
            ponctualite: (p.punctuality_status as Ponctualite) ?? "on_time",
            dureeSecondes: Number(p.presence_seconds ?? 0),
            taux: 0,
            retardSecondes: 0,
            departAnticipe: false,
            xp: { presence: 0, ponctualite: 0, penalite: 0, total: Number(p.xp_awarded ?? 0) },
          }
        : null,
      nbReponses: scores.length,
      scoreMoyen: scores.length > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null,
    };
  });

  const csv = bilanEnCsv({ titre: session.title as string, participants: lignes, feedback: feedbacks ?? [] });
  const nomFichier = `bilan-session-${(session.title as string).toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40)}.csv`;
  return new NextResponse(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${nomFichier}"`,
    },
  });
}

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/profile";

/**
 * « Rejoindre la visio » (lot 19) : enregistre le participant comme
 * suivant la session à distance, puis l'envoie vers Google Meet.
 *
 * - Pas encore inscrit à la session : passage par /rejoindre, qui
 *   demande le consentement à l'enregistrement si besoin.
 * - Encadrement : redirection directe vers la salle.
 *
 * Appelé par un lien simple (pas `next/link`) pour éviter tout
 * préchargement, qui déclencherait l'enregistrement de présence.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const origine = new URL(request.url).origin;
  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(new URL("/connexion", origine));

  const supabase = await createClient();
  const { data: session } = await supabase
    .from("live_sessions")
    .select("id, status, mode, meet_uri, session_code")
    .eq("id", id)
    .maybeSingle();
  if (!session) return NextResponse.redirect(new URL("/sessions", origine));

  const retour = new URL(`/sessions/${session.id}/participer`, origine);
  if (!session.meet_uri || session.mode === "onsite") return NextResponse.redirect(retour);

  const { data: encadrement } = await supabase.rpc("oversees_session", { sid: session.id });
  if (encadrement) return NextResponse.redirect(session.meet_uri as string);
  if (session.status !== "open") return NextResponse.redirect(retour);

  const { data: participation } = await supabase
    .from("session_participants")
    .update({ channel: "remote", left_at: null, attendance_status: "present" })
    .eq("session_id", session.id)
    .eq("user_id", user.id)
    .select("id")
    .maybeSingle();
  if (!participation) {
    return NextResponse.redirect(new URL(`/rejoindre?code=${session.session_code}&visio=1`, origine));
  }

  return NextResponse.redirect(session.meet_uri as string);
}

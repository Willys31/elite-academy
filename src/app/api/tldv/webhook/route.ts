import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { iaConfiguree, modeSimulation } from "@/lib/ai/client";
import { normaliserChargeTldv } from "@/lib/sessions/tldv";
import { analyserTranscription } from "@/lib/sessions/moteur";

/**
 * Webhook tl;dv (addendum Sessions hybrides §6.2).
 *
 * Aucune clé API tl;dv n'est disponible : cet endpoint reçoit ce que
 * tl;dv (ou n'importe quel outil de transcription) lui envoie, sous
 * plusieurs formes tolérées (`normaliserChargeTldv`). Il est protégé
 * par un secret partagé (`TLDV_WEBHOOK_SECRET`), comparé à temps
 * constant, et n'agit que sur une session dont l'identifiant tl;dv a
 * été renseigné par le formateur : jamais de création implicite.
 *
 * Idempotent : un rejeu du même `transcript_id` met à jour la ligne.
 */
export async function POST(req: NextRequest) {
  const secret = process.env.TLDV_WEBHOOK_SECRET;
  const fourni =
    req.headers.get("x-webhook-secret") ??
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    "";
  if (!secret || !comparaisonSure(fourni, secret)) {
    return NextResponse.json({ ok: false, error: "non autorisé" }, { status: 401 });
  }

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "JSON invalide" }, { status: 400 });
  }
  const charge = normaliserChargeTldv(json);
  if (!charge) {
    return NextResponse.json(
      { ok: false, error: "charge inexploitable : meeting_id et transcription attendus" },
      { status: 400 }
    );
  }

  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch {
    return NextResponse.json({ ok: false, error: "configuration serveur incomplète" }, { status: 500 });
  }

  const { data: session } = await admin
    .from("live_sessions")
    .select("id")
    .eq("tldv_meeting_id", charge.meetingId)
    .maybeSingle();
  if (!session) {
    console.info("[tldv] réunion inconnue :", charge.meetingId);
    return NextResponse.json({ ok: false, error: "session inconnue pour cette réunion" }, { status: 404 });
  }

  const { data: transcript, error } = await admin
    .from("meeting_transcripts")
    .upsert(
      {
        session_id: session.id,
        source: "tldv",
        tldv_transcript_id: charge.transcriptId,
        transcript_text: charge.texte,
        segments: charge.segments,
      },
      { onConflict: "tldv_transcript_id" }
    )
    .select("id")
    .single();
  if (error || !transcript) {
    console.error("[tldv] enregistrement :", error);
    return NextResponse.json({ ok: false, error: "enregistrement impossible" }, { status: 500 });
  }

  let analyse: string | null = "en attente";
  if (iaConfiguree() || modeSimulation()) {
    analyse = await analyserTranscription(transcript.id as string, null);
  } else {
    await admin.from("live_sessions").update({ analysis_status: "pending" }).eq("id", session.id);
  }
  console.info("[tldv] transcription reçue :", charge.transcriptId, "→ session", session.id);

  return NextResponse.json({ ok: true, transcriptId: transcript.id, analyse: analyse ?? "terminée" });
}

function comparaisonSure(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

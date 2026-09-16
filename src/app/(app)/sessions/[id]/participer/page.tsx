import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/profile";
import { SESSION_STATUS_LABELS } from "@/lib/sessions/sessions";
import {
  PONCTUALITE_LABELS,
  PRESENCE_LABELS,
  TON_PRESENCE,
  type Ponctualite,
  type StatutPresence,
} from "@/lib/sessions/presence";
import {
  donnerFeedbackSession,
  justifierDepart,
  quitterSession,
} from "@/app/(app)/sessions/actions";
import { SessionRealtimeRefresh } from "@/components/sessions/SessionRealtimeRefresh";
import { AuthForm } from "@/components/ui/AuthForm";
import { Alert, Badge, Card, PageTitle, Retour, Textarea } from "@/components/ui";
import { Etiquette } from "@/components/app";

export const metadata: Metadata = { title: "Session" };

const CRITERES = [
  ["satisfaction_score", "Satisfaction générale"],
  ["clarity_score", "Clarté des explications"],
  ["usefulness_score", "Utilité pour votre travail"],
] as const;

/**
 * Écran participant : présence confirmée, activité en cours (temps
 * réel), bouton « Quitter » ; après la clôture : statut de présence,
 * avis (une seule fois), justification d'un départ anticipé, résumé
 * de la session si l'enregistrement a été accepté.
 */
export default async function ParticiperPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) redirect("/connexion");

  const supabase = await createClient();
  const { data: session } = await supabase
    .from("live_sessions")
    .select(
      "id, title, status, current_activity_id, session_code, location, starts_at, ends_at, recording_enabled, course:courses(title)"
    )
    .eq("id", id)
    .maybeSingle();
  if (!session) notFound();

  const { data: presence } = await supabase
    .from("session_participants")
    .select("id, joined_at, left_at, presence_status, punctuality_status, xp_awarded, recording_consent, justification, justification_status")
    .eq("session_id", session.id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!presence) redirect(`/rejoindre?code=${session.session_code}`);

  const cloturee = session.status === "closed";
  const [{ data: activite }, { data: avis }, { data: transcript }] = await Promise.all([
    session.current_activity_id
      ? supabase.from("activities").select("id, title, type").eq("id", session.current_activity_id).maybeSingle()
      : Promise.resolve({ data: null }),
    cloturee
      ? supabase.from("session_feedbacks").select("id").eq("session_id", session.id).eq("user_id", user.id).maybeSingle()
      : Promise.resolve({ data: null }),
    cloturee && presence.recording_consent
      ? supabase
          .from("meeting_transcripts")
          .select("summary, key_points, insights")
          .eq("session_id", session.id)
          .not("analyzed_at", "is", null)
          .order("analyzed_at", { ascending: false })
          .limit(1)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const course = Array.isArray(session.course) ? session.course[0] : session.course;
  const dansLaSalle = !presence.left_at;
  const statut = presence.presence_status as StatutPresence | null;
  const ponctualite = presence.punctuality_status as Ponctualite | null;
  const departAnticipe = Boolean(presence.left_at) && session.ends_at && new Date(presence.left_at as string) < new Date(session.ends_at as string);
  const insights = (transcript?.insights ?? null) as { recommendations_learners?: string[] } | null;

  return (
    <div className="mx-auto max-w-md">
      <Retour href={`/sessions/${session.id}`} ton="sobre" />
      <SessionRealtimeRefresh sessionId={session.id} />

      <PageTitle action={<Badge>{SESSION_STATUS_LABELS[session.status]}</Badge>}>
        {session.title}
      </PageTitle>
      {course?.title || session.location ? (
        <p className="-mt-4 mb-6 text-sm text-slate-500">
          {[course?.title ? `Formation : ${course.title}` : null, session.location].filter(Boolean).join(" · ")}
        </p>
      ) : null}

      <Card className="text-center">
        <p className="text-sm text-green-700">
          ✓ Présence enregistrée à{" "}
          {new Date(presence.joined_at).toLocaleTimeString("fr-FR", {
            hour: "2-digit",
            minute: "2-digit",
          })}
          {presence.left_at
            ? ` · départ à ${new Date(presence.left_at as string).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}`
            : ""}
        </p>

        {cloturee ? (
          <div className="mt-4 space-y-3 text-left">
            <Alert kind="info">
              La session est terminée. Merci de votre participation — vos
              résultats sont conservés dans votre progression.
            </Alert>
            {statut ? (
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <Etiquette ton={TON_PRESENCE[statut]}>{PRESENCE_LABELS[statut]}</Etiquette>
                {ponctualite ? <Etiquette>{PONCTUALITE_LABELS[ponctualite]}</Etiquette> : null}
                {presence.xp_awarded ? <span className="text-slate-600">+{presence.xp_awarded} XP</span> : null}
              </div>
            ) : null}
          </div>
        ) : activite ? (
          <div className="mt-6">
            <p className="text-sm text-slate-600">Activité en cours :</p>
            <p className="mt-1 font-semibold">{activite.title}</p>
            <Link
              href={`/sessions/${session.id}/activite/${activite.id}`}
              className="mt-4 inline-flex min-h-11 items-center rounded-lg bg-brand-700 px-5 py-2 text-sm font-semibold text-white hover:bg-brand-800"
            >
              Répondre maintenant
            </Link>
          </div>
        ) : (
          <div className="mt-6">
            <p className="text-sm text-slate-500">
              En attente du formateur… Cet écran se mettra à jour
              automatiquement dès qu&apos;une activité sera lancée.
            </p>
            <div className="mx-auto mt-4 h-2 w-24 animate-pulse rounded-full bg-brand-200" />
          </div>
        )}

        {!cloturee ? (
          <div className="mt-6 border-t border-sand-200 pt-4">
            {dansLaSalle ? (
              <AuthForm action={quitterSession} submitLabel="Quitter la session" pendingLabel="…" ton="sobre">
                <input type="hidden" name="session_id" value={session.id} />
                <p className="text-xs text-slate-500">
                  Signalez votre départ : la durée de présence est calculée à la clôture.
                </p>
              </AuthForm>
            ) : (
              <p className="text-sm text-slate-600">
                Vous avez quitté la session.{" "}
                <Link href={`/rejoindre?code=${session.session_code}`} className="font-medium text-brand-700 hover:underline">
                  Revenir dans la salle
                </Link>
              </p>
            )}
          </div>
        ) : null}
      </Card>

      {/* ---------- Après la clôture ---------- */}
      {cloturee ? (
        <div className="mt-6 space-y-6">
          {departAnticipe && !presence.justification ? (
            <Card>
              <h2 className="font-semibold">Vous êtes parti avant la fin</h2>
              <p className="mt-1 text-sm text-slate-600">
                Si vous aviez une raison (urgence, contrainte professionnelle), expliquez-la : le formateur pourra recalculer votre présence.
              </p>
              <div className="mt-3">
                <AuthForm action={justifierDepart} submitLabel="Envoyer la justification" pendingLabel="…" ton="sobre">
                  <input type="hidden" name="session_id" value={session.id} />
                  <Textarea name="justification" rows={3} required minLength={5} maxLength={300} placeholder="Ex. : urgence professionnelle, rendez-vous client imprévu…" />
                </AuthForm>
              </div>
            </Card>
          ) : presence.justification ? (
            <Alert kind="info">
              Justification {presence.justification_status === "accepted" ? "acceptée" : presence.justification_status === "refused" ? "refusée" : "en attente de décision du formateur"} : « {presence.justification} »
            </Alert>
          ) : null}

          <Card>
            <h2 className="font-semibold">Votre avis sur la session</h2>
            {avis ? (
              <p className="mt-2 text-sm text-slate-600">Merci, votre avis a bien été pris en compte.</p>
            ) : (
              <div className="mt-3">
                <AuthForm action={donnerFeedbackSession} submitLabel="Envoyer mon avis" pendingLabel="…">
                  <input type="hidden" name="session_id" value={session.id} />
                  {CRITERES.map(([nom, libelle]) => (
                    <fieldset key={nom}>
                      <legend className="mb-1.5 text-sm font-medium text-ink-900">{libelle}</legend>
                      <div className="flex gap-1.5">
                        {[1, 2, 3, 4, 5].map((n) => (
                          <label key={n} className="flex size-11 cursor-pointer items-center justify-center rounded-lg border border-sand-300 text-sm font-medium has-checked:border-brand-700 has-checked:bg-brand-700 has-checked:text-white">
                            <input type="radio" name={nom} value={n} required className="sr-only" />
                            {n}
                          </label>
                        ))}
                      </div>
                    </fieldset>
                  ))}
                  <Textarea name="comment" rows={2} maxLength={500} placeholder="Un commentaire (facultatif)" />
                </AuthForm>
              </div>
            )}
          </Card>

          {session.recording_enabled ? (
            <Card>
              <h2 className="font-semibold">Résumé de la session</h2>
              {!presence.recording_consent ? (
                <p className="mt-2 text-sm text-slate-600">Vous avez refusé l&apos;enregistrement : le résumé n&apos;est pas accessible.</p>
              ) : !transcript ? (
                <p className="mt-2 text-sm text-slate-600">Le résumé sera disponible dès que la transcription aura été analysée.</p>
              ) : (
                <div className="mt-3 space-y-4 text-sm">
                  <p className="whitespace-pre-line leading-relaxed text-ink-900">{transcript.summary}</p>
                  {Array.isArray(transcript.key_points) && transcript.key_points.length > 0 ? (
                    <div>
                      <p className="font-medium text-ink-900">Points clés</p>
                      <ul className="mt-1 list-disc space-y-1 pl-5 text-slate-700">
                        {(transcript.key_points as string[]).map((p) => <li key={p}>{p}</li>)}
                      </ul>
                    </div>
                  ) : null}
                  {insights?.recommendations_learners?.length ? (
                    <div>
                      <p className="font-medium text-ink-900">Pour vous</p>
                      <ul className="mt-1 list-disc space-y-1 pl-5 text-slate-700">
                        {insights.recommendations_learners.map((r) => <li key={r}>{r}</li>)}
                      </ul>
                    </div>
                  ) : null}
                </div>
              )}
            </Card>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

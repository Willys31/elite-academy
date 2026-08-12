import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/profile";
import { SESSION_STATUS_LABELS } from "@/lib/sessions/sessions";
import { SessionRealtimeRefresh } from "@/components/sessions/SessionRealtimeRefresh";
import { Alert, Badge, Card, PageTitle } from "@/components/ui";

export const metadata: Metadata = { title: "Session" };

/**
 * Écran participant : présence confirmée, activité en cours
 * (mise à jour en temps réel), accès au QCM lancé par le formateur.
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
      "id, title, status, current_activity_id, session_code, course:courses(title)"
    )
    .eq("id", id)
    .maybeSingle();
  if (!session) notFound();

  const { data: presence } = await supabase
    .from("session_participants")
    .select("id, joined_at")
    .eq("session_id", session.id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!presence) redirect(`/rejoindre?code=${session.session_code}`);

  const { data: activite } = session.current_activity_id
    ? await supabase
        .from("activities")
        .select("id, title, type")
        .eq("id", session.current_activity_id)
        .maybeSingle()
    : { data: null };

  const course = Array.isArray(session.course) ? session.course[0] : session.course;
  const cloturee = session.status === "closed";

  return (
    <div className="mx-auto max-w-md">
      <SessionRealtimeRefresh sessionId={session.id} />

      <PageTitle action={<Badge>{SESSION_STATUS_LABELS[session.status]}</Badge>}>
        {session.title}
      </PageTitle>
      {course?.title ? (
        <p className="-mt-4 mb-6 text-sm text-slate-500">Formation : {course.title}</p>
      ) : null}

      <Card className="text-center">
        <p className="text-sm text-green-700">
          ✓ Présence enregistrée à{" "}
          {new Date(presence.joined_at).toLocaleTimeString("fr-FR", {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </p>

        {cloturee ? (
          <div className="mt-4">
            <Alert kind="info">
              La session est terminée. Merci de votre participation — vos
              résultats sont conservés dans votre progression.
            </Alert>
          </div>
        ) : activite ? (
          <div className="mt-6">
            <p className="text-sm text-slate-600">Activité en cours :</p>
            <p className="mt-1 font-semibold">{activite.title}</p>
            <Link
              href={`/sessions/${session.id}/activite/${activite.id}`}
              className="mt-4 inline-flex min-h-11 items-center rounded-lg bg-brand-600 px-5 py-2 text-sm font-medium text-white hover:bg-brand-700"
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
      </Card>
    </div>
  );
}

import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import QRCode from "qrcode";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/profile";
import {
  agregerResultats,
  SESSION_STATUS_LABELS,
} from "@/lib/sessions/sessions";
import { cloturerSession, lancerActivite } from "@/app/(app)/sessions/actions";
import { SessionRealtimeRefresh } from "@/components/sessions/SessionRealtimeRefresh";
import { AuthForm } from "@/components/ui/AuthForm";
import { Alert, BackLink, Badge, Card, EmptyState, PageTitle } from "@/components/ui";

export const metadata: Metadata = { title: "Session en direct" };

/**
 * Écran formateur de session en direct (UX/UI §4.4) :
 * code + QR code, présents, lancement d'activité, résultats en
 * temps réel, clôture. Le rafraîchissement est déclenché par
 * Supabase Realtime (composant SessionRealtimeRefresh).
 */
export default async function SessionDirectePage({
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
      "id, title, session_code, status, current_activity_id, trainer_id, course_id, organization_id, starts_at, course:courses(title, current_version_id)"
    )
    .eq("id", id)
    .maybeSingle();
  if (!session) notFound();

  // L'écran d'animation est réservé à l'encadrement ; un participant
  // est redirigé vers son écran.
  const { data: encadrement } = await supabase.rpc("oversees_session", {
    sid: session.id,
  });
  if (!encadrement) redirect(`/sessions/${session.id}/participer`);

  const course = Array.isArray(session.course) ? session.course[0] : session.course;

  // QCM disponibles de la formation liée.
  let activites: Array<{ id: string; title: string; lecon: string }> = [];
  if (course?.current_version_id) {
    const { data: modules } = await supabase
      .from("modules")
      .select("id, lessons(id, title, activities(id, title, type))")
      .eq("course_version_id", course.current_version_id);
    activites = (modules ?? []).flatMap((m) =>
      (m.lessons ?? []).flatMap((l) =>
        (l.activities ?? [])
          .filter((a) => a.type === "quiz")
          .map((a) => ({ id: a.id, title: a.title, lecon: l.title }))
      )
    );
  }

  const [{ data: participants }, { data: tentatives }] = await Promise.all([
    supabase
      .from("session_participants")
      .select("id, joined_at, profile:profiles(full_name, email)")
      .eq("session_id", session.id)
      .order("joined_at"),
    session.current_activity_id
      ? supabase
          .from("attempts")
          .select("user_id, score")
          .eq("activity_id", session.current_activity_id)
          .eq("session_id", session.id)
      : Promise.resolve({ data: [] }),
  ]);

  const stats = agregerResultats(
    (tentatives ?? []).map((t) => ({
      userId: t.user_id,
      score: t.score === null ? null : Number(t.score),
    }))
  );

  // Lien de participation encodé dans le QR code.
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? "http";
  const urlRejoindre = `${proto}://${host}/rejoindre?code=${session.session_code}`;
  const qrDataUrl = await QRCode.toDataURL(urlRejoindre, { width: 240, margin: 1 });

  const activiteEnCours = activites.find((a) => a.id === session.current_activity_id);
  const ouverte = session.status === "open";

  return (
    <div>
      <SessionRealtimeRefresh sessionId={session.id} />

      <BackLink href="/sessions">Sessions</BackLink>
      <PageTitle action={<Badge>{SESSION_STATUS_LABELS[session.status]}</Badge>}>
        {session.title}
      </PageTitle>
      {course?.title ? (
        <p className="-mt-4 mb-6 text-sm text-slate-500">Formation : {course.title}</p>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Code et QR */}
        <Card className="text-center">
          <h2 className="font-semibold">Rejoindre la session</h2>
          <p className="mt-3 text-3xl font-bold tracking-[0.3em] text-brand-700">
            {session.session_code}
          </p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={qrDataUrl}
            alt={`QR code pour rejoindre la session ${session.session_code}`}
            className="mx-auto mt-4 h-48 w-48"
          />
          <p className="mt-2 break-all text-xs text-slate-400">{urlRejoindre}</p>
        </Card>

        {/* Présents */}
        <Card>
          <h2 className="font-semibold">
            Présents ({(participants ?? []).length})
          </h2>
          {!participants || participants.length === 0 ? (
            <p className="mt-2 text-sm text-slate-500">
              Personne pour le moment — la liste se met à jour en direct.
            </p>
          ) : (
            <ul className="mt-3 max-h-64 space-y-1 overflow-y-auto text-sm">
              {participants.map((p) => {
                const profil = Array.isArray(p.profile) ? p.profile[0] : p.profile;
                return (
                  <li key={p.id} className="rounded bg-slate-50 px-3 py-1.5">
                    {profil?.full_name || profil?.email}
                    <span className="ml-2 text-xs text-slate-400">
                      {new Date(p.joined_at).toLocaleTimeString("fr-FR", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        {/* Résultats en direct */}
        <Card>
          <h2 className="font-semibold">Résultats en direct</h2>
          {!session.current_activity_id ? (
            <p className="mt-2 text-sm text-slate-500">
              Lancez une activité pour voir les réponses arriver.
            </p>
          ) : (
            <div className="mt-3 space-y-3 text-sm">
              <p className="font-medium text-slate-700">
                {activiteEnCours?.title ?? "Activité en cours"}
              </p>
              <p>
                {stats.nbRepondants} / {(participants ?? []).length} répondants
                {stats.moyenne !== null ? ` · moyenne ${stats.moyenne} %` : ""}
              </p>
              <ul className="space-y-1.5">
                {stats.repartition.map((r) => (
                  <li key={r.tranche} className="flex items-center gap-2">
                    <span className="w-20 text-xs text-slate-500">{r.tranche}</span>
                    <span
                      className="h-3 rounded bg-brand-500"
                      style={{
                        width: `${
                          stats.nbReponses === 0
                            ? 0
                            : Math.max(2, (r.nombre / stats.nbReponses) * 100)
                        }%`,
                      }}
                    />
                    <span className="text-xs text-slate-500">{r.nombre}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      </div>

      {/* Animation */}
      <div className="mt-6 grid gap-6 lg:grid-cols-[2fr_1fr]">
        <Card>
          <h2 className="mb-3 font-semibold">Lancer une activité</h2>
          {!session.course_id ? (
            <Alert kind="info">
              Cette session n&apos;est liée à aucune formation : liez une
              formation publiée à la création pour lancer ses QCM.
            </Alert>
          ) : activites.length === 0 ? (
            <EmptyState
              title="Aucun QCM disponible"
              hint="La formation liée ne contient pas encore de QCM."
            />
          ) : !ouverte ? (
            <p className="text-sm text-slate-500">Session clôturée.</p>
          ) : (
            <div className="space-y-2">
              {activites.map((a) => (
                <div
                  key={a.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2"
                >
                  <span className="text-sm">
                    {a.title}
                    <span className="ml-2 text-xs text-slate-400">({a.lecon})</span>
                    {a.id === session.current_activity_id ? (
                      <Badge>En cours</Badge>
                    ) : null}
                  </span>
                  <AuthForm
                    action={lancerActivite}
                    submitLabel={
                      a.id === session.current_activity_id ? "Relancer" : "Lancer"
                    }
                    pendingLabel="…"
                  >
                    <input type="hidden" name="session_id" value={session.id} />
                    <input type="hidden" name="activity_id" value={a.id} />
                    <input type="hidden" name="activity_title" value={a.title} />
                  </AuthForm>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card>
          <h2 className="mb-3 font-semibold">Clôturer</h2>
          {ouverte ? (
            <div>
              <p className="mb-3 text-sm text-slate-600">
                La clôture arrête les activités et conserve présences et
                résultats. Cette action est définitive.
              </p>
              <AuthForm
                action={cloturerSession}
                submitLabel="Clôturer la session"
                pendingLabel="Clôture…"
              >
                <input type="hidden" name="session_id" value={session.id} />
              </AuthForm>
            </div>
          ) : (
            <p className="text-sm text-slate-500">
              Session clôturée — présences et résultats conservés.
            </p>
          )}
        </Card>
      </div>
    </div>
  );
}

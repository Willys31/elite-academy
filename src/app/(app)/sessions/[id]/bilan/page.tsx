import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/profile";
import { iaConfiguree, modeSimulation } from "@/lib/ai/client";
import { SESSION_STATUS_LABELS } from "@/lib/sessions/sessions";
import {
  moyennesFeedback,
  PONCTUALITE_LABELS,
  PRESENCE_LABELS,
  tauxParticipation,
  TON_PRESENCE,
  type Ponctualite,
  type StatutPresence,
} from "@/lib/sessions/presence";
import { indicateursQualite, partFormateur, TYPE_INTERVENTION_LABELS, type InsightsSession, type TypeIntervention } from "@/lib/sessions/analyse";
import { statistiquesLocuteurs, type SegmentTranscription } from "@/lib/sessions/tldv";
import {
  definirIdentifiantTldv,
  importerTranscription,
  lancerAnalyseTranscription,
  traiterJustification,
} from "@/app/(app)/sessions/actions";
import { AuthForm } from "@/components/ui/AuthForm";
import { Alert, Badge, Card, PageTitle, Retour, SecondaryLink, TableScroll, Textarea } from "@/components/ui";
import { Champ, Chiffre, Etiquette, Panneau, Saisie, SectionTitre } from "@/components/app";

export const metadata: Metadata = { title: "Bilan de session" };

const STATUT_ANALYSE: Record<string, string> = {
  none: "Aucune analyse",
  pending: "En attente de configuration IA",
  running: "Analyse en cours",
  done: "Analyse terminée",
  failed: "Analyse échouée",
};

/**
 * Bilan de session pour l'encadrement (addendum Sessions §8.2) :
 * présences et ponctualité, justifications à traiter, avis, résumé et
 * insights de la transcription, interventions par participant, import
 * manuel et analyse IA, export CSV.
 */
export default async function BilanSessionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) redirect("/connexion");

  const supabase = await createClient();
  const { data: session } = await supabase
    .from("live_sessions")
    .select("id, title, status, starts_at, ends_at, closed_at, location, recording_enabled, tldv_meeting_id, analysis_status, trainer_id, course:courses(title)")
    .eq("id", id)
    .maybeSingle();
  if (!session) notFound();

  const { data: encadrement } = await supabase.rpc("oversees_session", { sid: session.id });
  if (!encadrement) redirect(`/sessions/${session.id}/participer`);

  const [{ data: participants }, { data: feedbacks }, { data: transcripts }, { data: observations }, { data: tentatives }, { data: lancements }] =
    await Promise.all([
      supabase
        .from("session_participants")
        .select("id, user_id, joined_at, left_at, presence_status, punctuality_status, presence_seconds, xp_awarded, recording_consent, justification, justification_status, profile:profiles(full_name, email)")
        .eq("session_id", session.id)
        .order("joined_at"),
      supabase.from("session_feedbacks").select("satisfaction_score, clarity_score, usefulness_score, comment").eq("session_id", session.id),
      supabase
        .from("meeting_transcripts")
        .select("id, source, tldv_transcript_id, transcript_text, segments, summary, key_points, keywords, insights, analyzed_at, created_at")
        .eq("session_id", session.id)
        .order("created_at", { ascending: false }),
      supabase
        .from("intervention_observations")
        .select("user_id, speaker_label, speaker_type, intervention_type, snippet, quality_score, start_seconds")
        .eq("session_id", session.id)
        .order("start_seconds"),
      supabase.from("attempts").select("user_id, activity_id, score").eq("session_id", session.id),
      supabase.from("live_events").select("id").eq("session_id", session.id).eq("type", "activity_launched"),
    ]);

  const premier = <T,>(v: T | T[] | null | undefined): T | null =>
    Array.isArray(v) ? (v[0] ?? null) : (v ?? null);

  const course = premier(session.course);
  const cloturee = session.status === "closed";
  const nbParticipants = (participants ?? []).length;
  const repondants = new Set((tentatives ?? []).map((t) => t.user_id as string));
  const scores = (tentatives ?? []).map((t) => Number(t.score)).filter((s) => Number.isFinite(s));
  const tauxReussite = scores.length > 0 ? scores.filter((s) => s >= 80).length / scores.length : null;
  const moyennes = moyennesFeedback(feedbacks ?? []);
  const feedbackMoyen =
    moyennes.satisfaction === null ? null : Math.round((((moyennes.satisfaction ?? 0) + (moyennes.clarte ?? moyennes.satisfaction) + (moyennes.utilite ?? moyennes.satisfaction)) / 3) * 10) / 10;

  const transcript = (transcripts ?? [])[0] ?? null;
  const segments = (transcript?.segments as SegmentTranscription[] | null) ?? [];
  const stats = statistiquesLocuteurs(Array.isArray(segments) ? segments : []);
  const locuteursFormateur = new Set(
    ((transcript?.insights ? [] : []) as string[]).concat(
      (observations ?? []).filter((o) => o.speaker_type === "trainer").map((o) => o.speaker_label as string)
    )
  );
  const insights = (transcript?.insights ?? null) as InsightsSession | null;
  const partForm = insights?.trainer_talk_ratio ?? partFormateur(stats, locuteursFormateur);
  const indicateurs = indicateursQualite({
    tauxParticipation: nbParticipants > 0 && (lancements ?? []).length > 0 ? tauxParticipation(repondants.size, nbParticipants) / 100 : null,
    partFormateur: partForm,
    tauxReussite,
    feedbackMoyen,
  });

  const interventionsPar = new Map<string, number>();
  for (const o of observations ?? []) {
    if (o.user_id) interventionsPar.set(o.user_id as string, (interventionsPar.get(o.user_id as string) ?? 0) + 1);
  }
  const justificationsEnAttente = (participants ?? []).filter((p) => p.justification_status === "pending");
  const iaDisponible = iaConfiguree() || modeSimulation();

  return (
    <div>
      <Retour href={`/sessions/${session.id}`} ton="sobre" />
      <PageTitle
        action={
          <>
            <Badge>{SESSION_STATUS_LABELS[session.status]}</Badge>
            {cloturee ? (
              <SecondaryLink href={`/sessions/${session.id}/bilan/export`}>Exporter en CSV</SecondaryLink>
            ) : null}
          </>
        }
      >
        Bilan · {session.title}
      </PageTitle>
      <p className="-mt-4 mb-6 text-sm text-slate-500">
        {[course?.title, session.location, session.closed_at ? `clôturée le ${new Date(session.closed_at).toLocaleString("fr-FR", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })}` : "session encore ouverte"]
          .filter(Boolean)
          .join(" · ")}
      </p>

      {!cloturee ? (
        <div className="mb-6">
          <Alert kind="info">
            Les présences et les points sont calculés à la clôture. Vous pouvez déjà importer une transcription ou renseigner l&apos;identifiant tl;dv.
          </Alert>
        </div>
      ) : null}

      {/* ---------- Indicateurs ---------- */}
      <dl className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Chiffre valeur={nbParticipants} libelle="Participants" detail={`${(participants ?? []).filter((p) => p.presence_status === "present").length} présents`} />
        <Chiffre valeur={`${tauxParticipation(repondants.size, nbParticipants)} %`} libelle="Participation" detail="ont répondu à une activité" />
        <Chiffre valeur={moyennes.n} libelle="Avis reçus" detail={moyennes.satisfaction !== null ? `${moyennes.satisfaction}/5 de satisfaction` : "aucun pour l'instant"} />
        <Chiffre valeur={STATUT_ANALYSE[session.analysis_status as string] ?? "—"} libelle="Transcription" detail={transcript ? `${(transcripts ?? []).length} reçue${(transcripts ?? []).length > 1 ? "s" : ""}` : "aucune"} />
      </dl>

      <Panneau className="mt-4">
        <SectionTitre>Qualité de la session</SectionTitre>
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {indicateurs.map((i) => (
            <li key={i.libelle} className="rounded-lg border border-sand-200 p-3">
              <p className="text-xs text-slate-500">{i.libelle}</p>
              <p className="mt-1 flex items-baseline gap-2 text-lg font-semibold text-ink-950">
                {i.valeur}
                {i.ok !== null ? <Etiquette ton={i.ok ? "succes" : "alerte"}>{i.ok ? "OK" : "À améliorer"}</Etiquette> : null}
              </p>
              <p className="text-xs text-slate-500">Cible : {i.cible}</p>
            </li>
          ))}
        </ul>
      </Panneau>

      {/* ---------- Présences ---------- */}
      <section className="mt-8">
        <SectionTitre compte={nbParticipants}>Présences</SectionTitre>
        {justificationsEnAttente.length > 0 ? (
          <div className="mb-4">
            <Alert kind="info">{justificationsEnAttente.length} justification{justificationsEnAttente.length > 1 ? "s" : ""} de départ à traiter ci-dessous.</Alert>
          </div>
        ) : null}
        <Card flush>
          <TableScroll>
            <table className="min-w-full text-sm">
              <thead className="border-b border-sand-200 text-left">
                <tr>
                  {["Participant", "Arrivée", "Départ", "Statut", "Ponctualité", "Durée", "XP", "Interventions", "Justification"].map((h) => (
                    <th key={h} className="whitespace-nowrap px-4 py-3 text-xs font-medium text-slate-500">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-sand-100">
                {(participants ?? []).map((p) => {
                  const profil = premier(p.profile);
                  const statut = p.presence_status as StatutPresence | null;
                  const ponct = p.punctuality_status as Ponctualite | null;
                  const heure = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) : "—");
                  return (
                    <tr key={p.id}>
                      <td className="px-4 py-3 font-medium text-ink-900">
                        {profil?.full_name || profil?.email}
                        {session.recording_enabled && !p.recording_consent ? <span className="ml-2 text-xs text-slate-400">sans enregistrement</span> : null}
                      </td>
                      <td className="px-4 py-3 tabular-nums">{heure(p.joined_at as string)}</td>
                      <td className="px-4 py-3 tabular-nums">{heure(p.left_at as string | null)}</td>
                      <td className="px-4 py-3">{statut ? <Etiquette ton={TON_PRESENCE[statut]}>{PRESENCE_LABELS[statut]}</Etiquette> : <span className="text-slate-400">à la clôture</span>}</td>
                      <td className="px-4 py-3 text-slate-600">{ponct ? PONCTUALITE_LABELS[ponct] : "—"}</td>
                      <td className="px-4 py-3 tabular-nums">{p.presence_seconds !== null ? `${Math.round(Number(p.presence_seconds) / 60)} min` : "—"}</td>
                      <td className="px-4 py-3 tabular-nums">{p.xp_awarded ? `+${p.xp_awarded}` : "—"}</td>
                      <td className="px-4 py-3 tabular-nums">{interventionsPar.get(p.user_id as string) ?? (observations?.length ? 0 : "—")}</td>
                      <td className="px-4 py-3">
                        {p.justification ? (
                          p.justification_status === "pending" ? (
                            <div className="space-y-1.5">
                              <p className="text-xs text-slate-600">« {p.justification} »</p>
                              <div className="flex gap-2">
                                <AuthForm action={traiterJustification} submitLabel="Accepter" pendingLabel="…" ton="sobre">
                                  <input type="hidden" name="participant_id" value={p.id} />
                                  <input type="hidden" name="decision" value="accepted" />
                                </AuthForm>
                                <AuthForm action={traiterJustification} submitLabel="Refuser" pendingLabel="…" ton="sobre">
                                  <input type="hidden" name="participant_id" value={p.id} />
                                  <input type="hidden" name="decision" value="refused" />
                                </AuthForm>
                              </div>
                            </div>
                          ) : (
                            <span className="text-xs text-slate-600">{p.justification_status === "accepted" ? "Acceptée" : "Refusée"}</span>
                          )
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableScroll>
        </Card>
      </section>

      {/* ---------- Avis ---------- */}
      <section className="mt-8">
        <SectionTitre compte={moyennes.n}>Avis des participants</SectionTitre>
        {moyennes.n === 0 ? (
          <p className="text-sm text-slate-500">Aucun avis pour l&apos;instant. Les participants sont invités à en donner un après la clôture.</p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-3">
            {[["Satisfaction", moyennes.satisfaction], ["Clarté", moyennes.clarte], ["Utilité", moyennes.utilite]].map(([l, v]) => (
              <Panneau key={l as string}>
                <p className="text-sm text-slate-500">{l}</p>
                <p className="mt-1 text-2xl font-semibold text-ink-950">{v !== null ? `${v}/5` : "—"}</p>
              </Panneau>
            ))}
            {(feedbacks ?? []).filter((f) => f.comment).length > 0 ? (
              <Panneau flush className="sm:col-span-3">
                <ul className="divide-y divide-sand-100">
                  {(feedbacks ?? []).filter((f) => f.comment).map((f, i) => (
                    <li key={i} className="px-5 py-3 text-sm leading-relaxed text-slate-700">« {f.comment} »</li>
                  ))}
                </ul>
              </Panneau>
            ) : null}
          </div>
        )}
      </section>

      {/* ---------- Transcription et analyse ---------- */}
      <section className="mt-8">
        <SectionTitre>Transcription et analyse IA</SectionTitre>
        <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
          <div className="space-y-6">
            {transcript?.summary ? (
              <Panneau>
                <p className="text-sm font-medium text-brand-700">Résumé</p>
                <p className="mt-2 whitespace-pre-line text-[15px] leading-relaxed text-ink-900">{transcript.summary}</p>
                {Array.isArray(transcript.key_points) && transcript.key_points.length > 0 ? (
                  <>
                    <p className="mt-5 text-sm font-medium text-brand-700">Points clés</p>
                    <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-slate-700">
                      {(transcript.key_points as string[]).map((k) => <li key={k}>{k}</li>)}
                    </ul>
                  </>
                ) : null}
                {Array.isArray(transcript.keywords) && transcript.keywords.length > 0 ? (
                  <div className="mt-4 flex flex-wrap gap-1.5">
                    {(transcript.keywords as string[]).map((k) => <Etiquette key={k}>{k}</Etiquette>)}
                  </div>
                ) : null}
              </Panneau>
            ) : null}

            {insights ? (
              <Panneau>
                <p className="text-sm font-medium text-brand-700">Insights et recommandations</p>
                <dl className="mt-3 grid gap-3 sm:grid-cols-2 text-sm">
                  <div><dt className="text-slate-500">Part de parole du formateur</dt><dd className="font-semibold text-ink-900">{insights.trainer_talk_ratio !== null ? `${Math.round(insights.trainer_talk_ratio * 100)} %` : "—"}</dd></div>
                  <div><dt className="text-slate-500">Participation estimée</dt><dd className="font-semibold text-ink-900">{insights.participation_rate !== null ? `${Math.round(insights.participation_rate * 100)} %` : "—"}</dd></div>
                </dl>
                {insights.recommendations_trainer.length > 0 ? (
                  <>
                    <p className="mt-4 text-sm font-medium text-ink-900">Pour vous</p>
                    <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-slate-700">{insights.recommendations_trainer.map((r) => <li key={r}>{r}</li>)}</ul>
                  </>
                ) : null}
                {insights.recommendations_learners.length > 0 ? (
                  <>
                    <p className="mt-4 text-sm font-medium text-ink-900">Pour les apprenants</p>
                    <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-slate-700">{insights.recommendations_learners.map((r) => <li key={r}>{r}</li>)}</ul>
                  </>
                ) : null}
                {insights.warnings.length > 0 ? (
                  <p className="mt-4 text-xs text-slate-500">Limites : {insights.warnings.join(" · ")}</p>
                ) : null}
              </Panneau>
            ) : null}

            {stats.length > 0 ? (
              <Panneau>
                <p className="text-sm font-medium text-brand-700">Prises de parole</p>
                <ul className="mt-3 space-y-2">
                  {stats.map((s) => (
                    <li key={s.locuteur} className="flex items-center gap-3 text-sm">
                      <span className="w-40 truncate font-medium text-ink-900">{s.locuteur}</span>
                      <span className="h-2 rounded-full bg-brand-500" style={{ width: `${Math.max(2, s.partMots)}%` }} />
                      <span className="text-xs text-slate-500">{s.partMots} % · {s.nbInterventions} intervention{s.nbInterventions > 1 ? "s" : ""}</span>
                    </li>
                  ))}
                </ul>
              </Panneau>
            ) : null}

            {(observations ?? []).length > 0 ? (
              <Panneau flush>
                <p className="px-5 pt-4 text-sm font-medium text-brand-700">Interventions relevées</p>
                <ul className="divide-y divide-sand-100">
                  {(observations ?? []).slice(0, 40).map((o, i) => (
                    <li key={i} className="px-5 py-3 text-sm">
                      <p className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-ink-900">{o.speaker_label}</span>
                        <Etiquette>{TYPE_INTERVENTION_LABELS[(o.intervention_type as TypeIntervention) ?? "remark"]}</Etiquette>
                        {o.quality_score ? <span className="text-xs text-slate-500">qualité {o.quality_score}/5</span> : null}
                      </p>
                      <p className="mt-1 text-slate-700">« {o.snippet} »</p>
                    </li>
                  ))}
                </ul>
              </Panneau>
            ) : null}

            {transcript && !transcript.analyzed_at ? (
              <Panneau>
                <p className="text-sm text-slate-600">
                  Transcription {transcript.source === "tldv" ? "reçue de tl;dv" : "importée"} le {new Date(transcript.created_at).toLocaleString("fr-FR", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })} — pas encore analysée.
                </p>
                {iaDisponible ? (
                  <div className="mt-3">
                    <AuthForm action={lancerAnalyseTranscription} submitLabel="Analyser avec l'IA" pendingLabel="Analyse en cours…">
                      <input type="hidden" name="transcript_id" value={transcript.id} />
                      <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm text-ink-900">
                        <input type="checkbox" name="anonymiser" className="size-4 accent-brand-700" />
                        Anonymiser les participants dans l&apos;analyse (« Apprenant 1 », « Apprenant 2 »…)
                      </label>
                    </AuthForm>
                  </div>
                ) : (
                  <p className="mt-2 text-xs text-slate-500">Aucune configuration IA (voir .env.example) : l&apos;analyse attendra.</p>
                )}
              </Panneau>
            ) : null}
            {transcript ? (
              <details className="text-sm">
                <summary className="cursor-pointer text-slate-500 hover:text-ink-900">Voir la transcription brute</summary>
                <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap rounded-lg border border-sand-200 bg-sand-50 p-4 text-xs leading-relaxed text-slate-700">{transcript.transcript_text}</pre>
              </details>
            ) : null}
          </div>

          <div className="space-y-6">
            <Panneau>
              <SectionTitre>Importer une transcription</SectionTitre>
              <p className="mb-3 text-xs leading-relaxed text-slate-500">
                Collez le texte (format « Nom : phrase », « [hh:mm:ss] Nom : phrase » ou « Nom (mm:ss): phrase »), ou importez un fichier .txt / .vtt.
              </p>
              <AuthForm action={importerTranscription} submitLabel="Importer" pendingLabel="Import…" ton="sobre">
                <input type="hidden" name="session_id" value={session.id} />
                <Textarea name="texte" rows={6} placeholder="Marie : Bonjour à tous, aujourd'hui…" />
                <div>
                  <Champ htmlFor="fichier" hint="facultatif">Fichier</Champ>
                  <input id="fichier" name="fichier" type="file" accept=".txt,.vtt,.srt,text/plain" className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-md file:border file:border-sand-300 file:bg-white file:px-3 file:py-1.5 file:text-sm file:font-medium" />
                </div>
              </AuthForm>
            </Panneau>

            <Panneau>
              <SectionTitre>Webhook tl;dv</SectionTitre>
              <p className="mb-3 text-xs leading-relaxed text-slate-500">
                Renseignez l&apos;identifiant de la réunion tl;dv : la transcription envoyée par webhook (<code className="font-mono">/api/tldv/webhook</code>, secret partagé) sera rattachée à cette session et analysée automatiquement.
              </p>
              <AuthForm action={definirIdentifiantTldv} submitLabel="Enregistrer" pendingLabel="…" ton="sobre">
                <input type="hidden" name="session_id" value={session.id} />
                <div>
                  <Champ htmlFor="tldv_meeting_id">Identifiant de réunion</Champ>
                  <Saisie id="tldv_meeting_id" name="tldv_meeting_id" defaultValue={(session.tldv_meeting_id as string) ?? ""} placeholder="ex. 64f1c2…" />
                </div>
              </AuthForm>
            </Panneau>
          </div>
        </div>
      </section>
    </div>
  );
}

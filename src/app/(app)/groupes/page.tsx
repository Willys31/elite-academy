import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/profile";
import { activeMemberships, isEliteAdmin } from "@/lib/auth/roles";
import { SESSION_STATUS_LABELS } from "@/lib/sessions/sessions";
import {
  resumerApprenants,
  type ParticipationBrute,
} from "@/lib/resultats/resultats";
import { Chiffre, EcranTitre, Etiquette, LienOr, LienSobre, Panneau, Retour, SectionTitre, Vide } from "@/components/app";

export const metadata: Metadata = { title: "Mes groupes" };

/**
 * Mes groupes.
 *
 * IMPORTANT — écart assumé avec la navigation : la base ne contient
 * aucune table de groupes nommés et persistants. Un « groupe » est donc
 * ici ce que les données permettent d'affirmer sans rien inventer : une
 * SESSION que vous avez animée, et les apprenants qui l'ont rejointe.
 *
 * C'est utile tout de suite (vous retrouvez vos cohortes, vous savez qui
 * revient), et c'est honnête : rien n'est simulé. De vrais groupes —
 * nommés, réutilisables d'une session à l'autre, avec attribution de
 * parcours — demandent une table `groups` et une migration ; c'est un
 * lot à part entière, à valider avant d'être engagé.
 */
export default async function GroupesPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/connexion");

  const actives = activeMemberships(user.memberships);
  const elite = isEliteAdmin(user.memberships);
  const orgsAnimation = actives
    .filter((m) => ["admin", "designer", "trainer"].includes(m.role))
    .map((m) => m.organization_id);

  if (!elite && orgsAnimation.length === 0) {
    return (
      <div>
        <EnTeteGroupes />
        <Vide
          titre="Vous n'animez aucune session"
          texte="Cet écran rassemble les apprenants rencontrés en session. Il se remplit dès que vous en animez une."
          action={<LienSobre href="/accueil">Retour au tableau de bord</LienSobre>}
        />
      </div>
    );
  }

  const supabase = await createClient();

  /* Sessions que cet utilisateur encadre. La RLS laisse déjà passer les
     seules sessions de ses organisations ; le filtre sur `trainer_id`
     n'est appliqué qu'aux formateurs, pour qu'un responsable ou un
     administrateur garde la vue complète de son organisation. */
  let requeteSessions = supabase
    .from("live_sessions")
    .select(
      "id, title, session_code, status, starts_at, created_at, trainer_id, course:courses(id, title)"
    )
    .order("created_at", { ascending: false })
    .limit(60);
  if (!elite && !actives.some((m) => ["admin", "manager"].includes(m.role))) {
    requeteSessions = requeteSessions.eq("trainer_id", user.id);
  }
  const { data: sessions } = await requeteSessions;

  const idsSessions = (sessions ?? []).map((s) => s.id as string);

  const { data: participations } =
    idsSessions.length > 0
      ? await supabase
          .from("session_participants")
          .select("session_id, user_id, joined_at, attendance_status")
          .in("session_id", idsSessions)
      : { data: [] as Array<Record<string, unknown>> };

  const idsApprenants = [
    ...new Set((participations ?? []).map((p) => p.user_id as string)),
  ];
  const noms = new Map<string, string>();
  if (idsApprenants.length > 0) {
    const { data: profils } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", idsApprenants);
    for (const p of profils ?? []) {
      noms.set(p.id as string, (p.full_name as string) || "Apprenant");
    }
  }

  const brutes: ParticipationBrute[] = (participations ?? []).map((p) => ({
    sessionId: p.session_id as string,
    userId: p.user_id as string,
    nom: noms.get(p.user_id as string) ?? "Apprenant",
    joinedAt: (p.joined_at as string) ?? null,
  }));
  const apprenants = resumerApprenants(brutes);

  const participantsParSession = new Map<string, number>();
  for (const p of brutes) {
    participantsParSession.set(
      p.sessionId,
      (participantsParSession.get(p.sessionId) ?? 0) + 1
    );
  }

  const sessionsListe = (sessions ?? []).map((s) => {
    const course = Array.isArray(s.course) ? s.course[0] : s.course;
    return {
      id: s.id as string,
      titre: s.title as string,
      code: s.session_code as string,
      statut: s.status as string,
      date: (s.starts_at as string) ?? (s.created_at as string),
      formation: course?.title ?? null,
      participants: participantsParSession.get(s.id as string) ?? 0,
    };
  });

  const ouvertes = sessionsListe.filter((s) => s.statut === "open");
  const fideles = apprenants.filter((a) => a.nbSessions > 1).length;

  return (
    <div>
      <Retour href="/accueil" />
      <EnTeteGroupes />

      {sessionsListe.length === 0 ? (
        <Vide
          titre="Aucune session pour le moment"
          texte="Ouvrez une session : les participants la rejoignent par code ou QR code, et le groupe se constitue tout seul ici."
          action={<LienOr href="/sessions">Créer une session</LienOr>}
        />
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Chiffre
              valeur={sessionsListe.length}
              libelle="Sessions"
              detail="animées à ce jour"
              href="/sessions"
            />
            <Chiffre
              valeur={ouvertes.length}
              libelle="Ouvertes"
              detail="en ce moment"
            />
            <Chiffre
              valeur={apprenants.length}
              libelle="Apprenants"
              detail="rencontrés, sans doublon"
            />
            <Chiffre
              valeur={fideles}
              libelle="Fidèles"
              detail="revenus au moins deux fois"
            />
          </dl>

          {/* ---------- Les groupes, c'est-à-dire les sessions ---------- */}
          <section className="mt-10">
            <SectionTitre
              compte={sessionsListe.length}
              action={<LienSobre href="/sessions">Gérer mes sessions</LienSobre>}
            >
              Groupes par session
            </SectionTitre>
            <Panneau flush>
              <ul className="divide-y divide-sand-200">
                {sessionsListe.map((s) => (
                  <li key={s.id}>
                    <Link
                      href={`/sessions/${s.id}`}
                      className="flex flex-wrap items-center justify-between gap-x-5 gap-y-2 px-5 py-4 transition duration-200 hover:bg-sand-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600"
                    >
                      <div className="min-w-0">
                        <p className="font-medium text-ink-900">{s.titre}</p>
                        <p className="mt-0.5 text-xs text-slate-400">
                          {[
                            s.formation,
                            `code ${s.code}`,
                            s.date
                              ? new Date(s.date).toLocaleDateString("fr-FR", {
                                  day: "numeric",
                                  month: "long",
                                  year: "numeric",
                                })
                              : null,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-3">
                        <span className="text-sm tabular-nums text-slate-500">
                          {s.participants} participant
                          {s.participants > 1 ? "s" : ""}
                        </span>
                        <Etiquette ton={s.statut === "open" ? "succes" : "neutre"}>
                          {SESSION_STATUS_LABELS[s.statut] ?? s.statut}
                        </Etiquette>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            </Panneau>
          </section>

          {/* ---------- Le répertoire des apprenants ---------- */}
          <section className="mt-10">
            <SectionTitre compte={apprenants.length}>
              Apprenants rencontrés
            </SectionTitre>
            {apprenants.length === 0 ? (
              <Panneau>
                <p className="text-sm leading-relaxed text-slate-600">
                  Vos sessions existent, mais personne ne les a encore
                  rejointes. Affichez le code ou le QR code en salle : chaque
                  arrivée s&apos;enregistre ici automatiquement.
                </p>
              </Panneau>
            ) : (
              <Panneau flush>
                <ul className="divide-y divide-sand-200">
                  {apprenants.map((a) => (
                    <li
                      key={a.userId}
                      className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-5 py-3.5"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-ink-900">{a.nom}</p>
                        {a.dernierePresence ? (
                          <p className="text-xs text-slate-400">
                            Dernière présence le{" "}
                            {new Date(a.dernierePresence).toLocaleDateString(
                              "fr-FR",
                              { day: "numeric", month: "long", year: "numeric" }
                            )}
                          </p>
                        ) : null}
                      </div>
                      <Etiquette ton={a.nbSessions > 1 ? "or" : "neutre"}>
                        {a.nbSessions} session{a.nbSessions > 1 ? "s" : ""}
                      </Etiquette>
                    </li>
                  ))}
                </ul>
              </Panneau>
            )}
          </section>

          {/* ---------- Ce que l'écran ne fait pas encore ---------- */}
          <Panneau className="mt-10">
            <SectionTitre>Groupes nommés : à décider</SectionTitre>
            <p className="text-sm leading-relaxed text-slate-600">
              Les groupes ci-dessus sont déduits de vos sessions. La
              plateforme ne sait pas encore enregistrer un groupe nommé et
              durable — « Promotion 2026 », « Équipe agence Plateau » — qu&apos;on
              réutilise d&apos;une session à l&apos;autre et auquel on attribue un
              parcours. Cela demande une nouvelle table et une migration :
              c&apos;est un lot à part, à valider avant d&apos;être engagé.
            </p>
          </Panneau>
        </>
      )}
    </div>
  );
}

function EnTeteGroupes() {
  return (
    <EcranTitre
      eyebrow="Vue formateur"
      intro="Vos groupes sont constitués à partir de vos sessions : chaque session réunit les apprenants qui l'ont rejointe par code ou QR code."
      action={<LienSobre href="/resultats">Voir les résultats</LienSobre>}
    >
      Mes groupes
    </EcranTitre>
  );
}

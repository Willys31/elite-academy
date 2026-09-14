import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/profile";
import { activeMemberships, isEliteAdmin } from "@/lib/auth/roles";
import { SESSION_STATUS_LABELS } from "@/lib/sessions/sessions";
import { creerSession } from "@/app/(app)/sessions/actions";
import { AuthForm } from "@/components/ui/AuthForm";
import { Alert } from "@/components/ui";
import {
  Champ,
  EcranTitre,
  Etiquette,
  LienSobre,
  Panneau,
  Saisie,
  SectionTitre,
  Vide,
} from "@/components/app";

export const metadata: Metadata = { title: "Sessions" };

/** Liste déroulante à la charte, sans dupliquer les classes du champ. */
const CLASSES_SELECT =
  "block min-h-11 w-full rounded-xl border border-sand-200 bg-sand-50/60 px-3.5 py-2.5 text-base text-ink-900 outline-none transition duration-200 focus:border-gold-400 focus:bg-white focus:ring-4 focus:ring-gold-300/25 sm:text-sm";

export default async function SessionsPage({
  searchParams,
}: {
  searchParams: Promise<{ supprimee?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/connexion");
  const params = await searchParams;

  const actives = activeMemberships(user.memberships);
  const elite = isEliteAdmin(user.memberships);
  let orgsAnimation = actives
    .filter((m) => ["admin", "designer", "trainer"].includes(m.role))
    .map((m) => ({ id: m.organization_id, name: m.organization?.name ?? "Organisation" }));

  const supabase = await createClient();
  if (elite) {
    const { data } = await supabase.from("organizations").select("id, name").order("name");
    orgsAnimation = data ?? orgsAnimation;
  }
  const animateur = orgsAnimation.length > 0;

  const [{ data: sessions }, { data: formations }] = await Promise.all([
    supabase
      .from("live_sessions")
      .select(
        "id, title, session_code, status, starts_at, created_at, trainer_id, course:courses(title), organization:organizations(name)"
      )
      .order("created_at", { ascending: false })
      .limit(30),
    animateur
      ? supabase
          .from("courses")
          .select("id, title, organization_id")
          .eq("status", "published")
          .order("title")
      : Promise.resolve({ data: [] }),
  ]);

  const listees = sessions ?? [];
  /* Les sessions ouvertes remontent en tête : c'est la seule catégorie
     sur laquelle on agit dans l'instant. Le reste est de l'historique. */
  const ouvertes = listees.filter((s) => s.status === "open");
  const autres = listees.filter((s) => s.status !== "open");

  return (
    <div>
      <EcranTitre
        eyebrow={animateur ? "Vue formateur" : "Sessions présentielles"}
        intro={
          animateur
            ? "Une session ouverte affiche un code : les participants le saisissent depuis leur téléphone et vous voyez leurs réponses arriver en direct."
            : "Les sessions ouvertes de votre organisation apparaissent ici. Vous pouvez aussi rejoindre directement avec un code."
        }
        action={<LienSobre href="/rejoindre">Rejoindre avec un code</LienSobre>}
      >
        Sessions
      </EcranTitre>

      {params.supprimee ? (
        <div className="mb-6">
          <Alert kind="success">
            Session supprimée. Les résultats de QCM des apprenants sont
            conservés.
          </Alert>
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <section aria-label="Sessions">
          {listees.length === 0 ? (
            <Vide
              titre="Aucune session"
              texte={
                animateur
                  ? "Créez votre première session avec le formulaire ci-contre : les participants la rejoindront par code ou QR code."
                  : "Les sessions ouvertes de votre organisation apparaîtront ici."
              }
              action={<LienSobre href="/rejoindre">Rejoindre avec un code</LienSobre>}
            />
          ) : (
            <div className="space-y-8">
              {ouvertes.length > 0 ? (
                <div>
                  <SectionTitre compte={ouvertes.length}>En cours</SectionTitre>
                  <ListeSessions
                    sessions={ouvertes}
                    userId={user.id}
                    animateur={animateur}
                  />
                </div>
              ) : null}
              {autres.length > 0 ? (
                <div>
                  <SectionTitre compte={autres.length}>
                    Programmées et clôturées
                  </SectionTitre>
                  <ListeSessions
                    sessions={autres}
                    userId={user.id}
                    animateur={animateur}
                  />
                </div>
              ) : null}
            </div>
          )}
        </section>

        {animateur ? (
          <section aria-label="Créer une session">
            <Panneau>
              <SectionTitre>Nouvelle session</SectionTitre>
              <AuthForm
                action={creerSession}
                submitLabel="Créer et ouvrir la session"
                pendingLabel="Création…"
              >
                <div>
                  <Champ htmlFor="organization_id">Organisation</Champ>
                  <select
                    id="organization_id"
                    name="organization_id"
                    required
                    className={CLASSES_SELECT}
                  >
                    {orgsAnimation.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <Champ htmlFor="title">Titre</Champ>
                  <Saisie
                    id="title"
                    name="title"
                    required
                    placeholder="Ex. : Atelier gestion des conflits — groupe A"
                  />
                </div>
                <div>
                  <Champ htmlFor="course_id" hint="facultatif">
                    Formation liée
                  </Champ>
                  <select
                    id="course_id"
                    name="course_id"
                    defaultValue=""
                    className={CLASSES_SELECT}
                  >
                    <option value="">— Aucune —</option>
                    {(formations ?? []).map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.title}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1.5 text-xs text-slate-500">
                    Lier une formation publiée permet de lancer ses QCM en
                    direct pendant l&apos;atelier.
                  </p>
                </div>
                <div>
                  <Champ htmlFor="starts_at" hint="facultatif">
                    Date et heure
                  </Champ>
                  <Saisie id="starts_at" name="starts_at" type="datetime-local" />
                </div>
              </AuthForm>
            </Panneau>
          </section>
        ) : null}
      </div>
    </div>
  );
}

function ListeSessions({
  sessions,
  userId,
  animateur,
}: {
  sessions: Array<Record<string, unknown>>;
  userId: string;
  animateur: boolean;
}) {
  return (
    <Panneau flush>
      <ul className="divide-y divide-sand-200">
        {sessions.map((s) => {
          const course = Array.isArray(s.course) ? s.course[0] : s.course;
          const org = Array.isArray(s.organization)
            ? s.organization[0]
            : s.organization;
          const estAnimateur = s.trainer_id === userId || animateur;
          const ouverte = s.status === "open";
          return (
            <li key={s.id as string}>
              <Link
                href={
                  estAnimateur
                    ? `/sessions/${s.id}`
                    : `/sessions/${s.id}/participer`
                }
                className="flex flex-wrap items-center justify-between gap-x-5 gap-y-2 px-5 py-4 transition duration-200 hover:bg-sand-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400"
              >
                <div className="min-w-0">
                  <p className="font-medium text-ink-900">{s.title as string}</p>
                  <p className="mt-0.5 text-xs text-slate-400">
                    {[
                      (org as { name?: string })?.name,
                      (course as { title?: string })?.title,
                      s.starts_at
                        ? new Date(s.starts_at as string).toLocaleString("fr-FR", {
                            day: "numeric",
                            month: "long",
                            hour: "2-digit",
                            minute: "2-digit",
                          })
                        : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  {/* Le code n'est mis en avant que sur une session ouverte :
                      ailleurs, il n'a plus d'usage. */}
                  <span
                    className={`font-mono text-sm tracking-[0.14em] ${
                      ouverte ? "font-semibold text-ink-900" : "text-slate-400"
                    }`}
                  >
                    {s.session_code as string}
                  </span>
                  <Etiquette ton={ouverte ? "succes" : "neutre"}>
                    {SESSION_STATUS_LABELS[s.status as string] ??
                      (s.status as string)}
                  </Etiquette>
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </Panneau>
  );
}

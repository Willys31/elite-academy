import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/profile";
import { activeMemberships, isEliteAdmin } from "@/lib/auth/roles";
import { SESSION_STATUS_LABELS } from "@/lib/sessions/sessions";
import {
  etiquettePortee,
  PORTEE_DESCRIPTIONS,
  PORTEE_LABELS,
  PORTEES,
  porteeValide,
  recommandationPortee,
} from "@/lib/partage/visibilite";
import { creerSession } from "@/app/(app)/sessions/actions";
import { AuthForm } from "@/components/ui/AuthForm";
import { Alert, Textarea } from "@/components/ui";
import { Champ, EcranTitre, Etiquette, LienSobre, Panneau, Retour, Saisie, SectionTitre, Vide } from "@/components/app";

export const metadata: Metadata = { title: "Sessions" };

/** Liste déroulante à la charte, sans dupliquer les classes du champ. */
const CLASSES_SELECT =
  "block min-h-11 w-full rounded-lg border border-sand-300 bg-white px-3.5 py-2.5 text-base text-ink-900 outline-none transition duration-200 focus:border-brand-600 focus:bg-white focus:ring-4 focus:ring-brand-600/15 sm:text-sm";

export default async function SessionsPage({
  searchParams,
}: {
  searchParams: Promise<{ supprimee?: string; portee?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/connexion");
  const params = await searchParams;
  const filtrePortee = porteeValide(params.portee) ? params.portee : null;

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
        "id, title, session_code, status, starts_at, ends_at, location, visibility_scope, created_at, trainer_id, course:courses(title), organization:organizations(name)"
      )
      .order("created_at", { ascending: false })
      .limit(50),
    animateur
      ? supabase
          .from("courses")
          .select("id, title, organization_id")
          .eq("status", "published")
          .order("title")
      : Promise.resolve({ data: [] }),
  ]);

  const listees = (sessions ?? []).filter(
    (s) => !filtrePortee || s.visibility_scope === filtrePortee
  );
  /* Les sessions ouvertes remontent en tête : c'est la seule catégorie
     sur laquelle on agit dans l'instant. Le reste est de l'historique. */
  const ouvertes = listees.filter((s) => s.status === "open");
  const autres = listees.filter((s) => s.status !== "open");

  return (
    <div>
      <Retour href="/accueil" />
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
          {/* Filtre par niveau de partage (addendum Sessions §11.4). */}
          <nav aria-label="Filtrer par portée" className="mb-4 flex flex-wrap gap-2">
            {[null, ...PORTEES].map((p) => (
              <Link
                key={p ?? "toutes"}
                href={p ? `/sessions?portee=${p}` : "/sessions"}
                className={`rounded-md border px-3 py-1.5 text-sm font-medium transition-colors duration-150 ${
                  p === filtrePortee
                    ? "border-brand-700 bg-brand-700 text-white"
                    : "border-sand-300 bg-white text-slate-700 hover:bg-sand-50"
                }`}
              >
                {p ? PORTEE_LABELS[p] : "Toutes"}
              </Link>
            ))}
          </nav>
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
                  <Champ htmlFor="description" hint="facultatif">
                    Description
                  </Champ>
                  <Textarea id="description" name="description" rows={2} maxLength={500} placeholder="Objectifs, déroulé, matériel à prévoir…" />
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <Champ htmlFor="starts_at" hint="facultatif">
                      Début
                    </Champ>
                    <Saisie id="starts_at" name="starts_at" type="datetime-local" />
                  </div>
                  <div>
                    <Champ htmlFor="ends_at" hint="facultatif">
                      Fin prévue
                    </Champ>
                    <Saisie id="ends_at" name="ends_at" type="datetime-local" />
                  </div>
                </div>
                <p className="-mt-2 text-xs text-slate-500">
                  Début et fin servent au calcul de la ponctualité et de la
                  présence à la clôture.
                </p>
                <div>
                  <Champ htmlFor="location" hint="facultatif">
                    Lieu ou lien
                  </Champ>
                  <Saisie id="location" name="location" placeholder="Salle B2 · ou lien de visioconférence" />
                </div>
                <fieldset>
                  <legend className="mb-1.5 text-sm font-medium text-ink-900">Qui peut la voir et la rejoindre ?</legend>
                  <div className="space-y-2">
                    {PORTEES.map((p) => (
                      <label key={p} className="flex cursor-pointer gap-3 rounded-lg border border-sand-200 px-3.5 py-2.5 text-sm has-checked:border-brand-600 has-checked:bg-brand-50">
                        <input type="radio" name="portee" value={p} defaultChecked={p === "organization"} className="mt-0.5 size-4 accent-brand-700" />
                        <span>
                          <span className="font-medium text-ink-900">{PORTEE_LABELS[p]}</span>
                          <span className="block text-xs leading-relaxed text-slate-500">{PORTEE_DESCRIPTIONS[p]} {recommandationPortee(p)}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                </fieldset>
                <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm text-ink-900">
                  <input type="checkbox" name="recording_enabled" className="size-4 accent-brand-700" />
                  Session enregistrée et transcrite (consentement demandé aux participants)
                </label>
                <div>
                  <Champ htmlFor="tldv_meeting_id" hint="facultatif">
                    Identifiant de réunion tl;dv
                  </Champ>
                  <Saisie id="tldv_meeting_id" name="tldv_meeting_id" placeholder="Pour rattacher automatiquement la transcription" />
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
          const portee = etiquettePortee((s.visibility_scope as "group") ?? "organization");
          return (
            <li key={s.id as string}>
              <Link
                href={
                  estAnimateur
                    ? `/sessions/${s.id}`
                    : `/sessions/${s.id}/participer`
                }
                className="flex flex-wrap items-center justify-between gap-x-5 gap-y-2 px-5 py-4 transition duration-200 hover:bg-sand-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600"
              >
                <div className="min-w-0">
                  <p className="font-medium text-ink-900">{s.title as string}</p>
                  <p className="mt-0.5 text-xs text-slate-400">
                    {[
                      (org as { name?: string })?.name,
                      (course as { title?: string })?.title,
                      s.location as string | null,
                      s.starts_at
                        ? new Date(s.starts_at as string).toLocaleString("fr-FR", {
                            day: "numeric",
                            month: "long",
                            hour: "2-digit",
                            minute: "2-digit",
                          }) +
                          (s.ends_at
                            ? ` → ${new Date(s.ends_at as string).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}`
                            : "")
                        : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <Etiquette ton={portee.ton}>{portee.libelle}</Etiquette>
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

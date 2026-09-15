import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/profile";
import {
  activeMemberships,
  isEliteAdmin,
  navigationFor,
  primaryRole,
  ROLE_LABELS,
} from "@/lib/auth/roles";
import { calculerCompletion } from "@/lib/courses/progression";
import { lireTentative, questionsARevoir } from "@/lib/courses/revision";
import { STATUTS_AVEC_ACCES } from "@/lib/courses/inscriptions";
import { SESSION_STATUS_LABELS } from "@/lib/sessions/sessions";
import {
  Chiffre,
  EcranTitre,
  Etiquette,
  LienOr,
  LienSobre,
  Panneau,
  PanneauLien,
  SectionTitre,
  Vide,
} from "@/components/app";

export const metadata: Metadata = { title: "Accueil" };

/** « Aucune leçon terminée », « 1 leçon terminée », « 4 leçons terminées ». */
function compteLecons(n: number): string {
  if (n === 0) return "Aucune leçon terminée";
  return `${n} leçon${n > 1 ? "s" : ""} terminée${n > 1 ? "s" : ""}`;
}

/**
 * Écran d'accueil.
 *
 * Apprenant et formateur ont chacun un vrai tableau de bord : chacun
 * répond d'abord à « que dois-je faire maintenant ? » avant de donner
 * les chiffres. Les rôles dont les écrans ne sont pas encore repris
 * gardent une vue de situation sobre — mieux vaut un écran honnête
 * qu'un tableau de bord qui simule des données.
 */
export default async function AccueilPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/connexion");

  const memberships = activeMemberships(user.memberships);
  const role = primaryRole(user.memberships);
  const prenom = user.fullName ? user.fullName.split(" ")[0] : "";

  if (role === "trainer") {
    return <VueFormateur userId={user.id} prenom={prenom} />;
  }

  if (role !== "learner") {
    return (
      <VueRoleNonApprenant
        prenom={prenom}
        role={role}
        admin={isEliteAdmin(user.memberships)}
        organisations={memberships.map((m) => ({
          id: m.organization_id,
          nom: m.organization?.name ?? "Organisation",
          role: ROLE_LABELS[m.role],
        }))}
      />
    );
  }

  const supabase = await createClient();

  const [
    { data: inscriptions },
    { data: leconsFaites },
    { data: competences },
    { count: nbCertificats },
    { data: tentatives },
  ] = await Promise.all([
    supabase
      .from("enrollments")
      .select("id, status, course:courses(id, title, current_version_id)")
      .eq("user_id", user.id)
      .in("status", [...STATUTS_AVEC_ACCES])
      .order("created_at", { ascending: false }),
    supabase
      .from("progress_records")
      .select("course_id, lesson_id, updated_at")
      .eq("user_id", user.id)
      .not("lesson_id", "is", null)
      .order("updated_at", { ascending: false }),
    supabase
      .from("progress_records")
      .select("mastery_level")
      .eq("user_id", user.id)
      .not("competency_id", "is", null),
    supabase
      .from("certificates")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .eq("status", "valid"),
    supabase
      .from("attempts")
      .select("activity_id, score, submitted_at, started_at, feedback")
      .eq("user_id", user.id),
  ]);

  const lignes = (inscriptions ?? [])
    .map((i) => {
      const course = Array.isArray(i.course) ? i.course[0] : i.course;
      return course ? { statut: i.status, course } : null;
    })
    .filter(Boolean) as Array<{
    statut: string;
    course: { id: string; title: string; current_version_id: string | null };
  }>;

  const enCours = lignes.filter((l) => l.statut === "active");
  const terminees = lignes.filter((l) => l.statut === "completed");

  const faitesParCours = new Map<string, number>();
  for (const p of leconsFaites ?? []) {
    faitesParCours.set(p.course_id, (faitesParCours.get(p.course_id) ?? 0) + 1);
  }

  const nbCompetencesAcquises = (competences ?? []).filter(
    (c) => c.mastery_level !== null
  ).length;

  const aRevoir = questionsARevoir((tentatives ?? []).map(lireTentative));

  /* Formation à reprendre : celle sur laquelle l'apprenant a travaillé en
     dernier, si elle est toujours en cours. Sinon, la plus récemment
     rejointe. Reprendre là où on s'est arrêté vaut mieux que présenter
     une liste dans laquelle il faut se retrouver. */
  const dernierCours = (leconsFaites ?? [])[0]?.course_id ?? null;
  const aReprendre =
    enCours.find((l) => l.course.id === dernierCours) ?? enCours[0] ?? null;

  let completionReprise = 0;
  if (aReprendre?.course.current_version_id) {
    const { data: modules } = await supabase
      .from("modules")
      .select("id")
      .eq("course_version_id", aReprendre.course.current_version_id);
    const ids = (modules ?? []).map((m) => m.id);
    if (ids.length > 0) {
      const { count } = await supabase
        .from("lessons")
        .select("id", { count: "exact", head: true })
        .in("module_id", ids);
      completionReprise = calculerCompletion(
        faitesParCours.get(aReprendre.course.id) ?? 0,
        count ?? 0
      );
    }
  }

  return (
    <div>
      <EcranTitre
        eyebrow={`Espace apprenant${
          memberships[0]?.organization?.name
            ? ` · ${memberships[0].organization.name}`
            : ""
        }`}
        intro="Votre maîtrise est mesurée compétence par compétence, à partir de vos meilleurs résultats."
      >
        Bonjour{prenom ? ` ${prenom}` : ""}
      </EcranTitre>

      {/* ---------- Reprendre ---------- */}
      {aReprendre ? (
        <Panneau ton="encre" className="relative overflow-hidden !p-0">
          <div className="relative flex flex-col gap-6 p-6 sm:p-7 lg:flex-row lg:items-end lg:justify-between">
            <div className="min-w-0">
              <p className="text-sm font-medium text-brand-200">
                Reprendre où vous en étiez
              </p>
              <h2 className="mt-2 font-display text-xl font-semibold text-white sm:text-2xl">
                {aReprendre.course.title}
              </h2>
              <div className="mt-4 max-w-sm">
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                  <div
                    className="h-full rounded-full bg-gold-400 transition-[width] duration-500"
                    style={{ width: `${completionReprise}%` }}
                  />
                </div>
                <p className="mt-2 text-xs text-white/50">
                  {completionReprise} % des leçons terminées
                </p>
              </div>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              <LienOr
                href={`/formations/${aReprendre.course.id}`}
                className="!bg-white !text-brand-900 hover:!bg-brand-50"
              >
                Continuer
              </LienOr>
              <LienSobre
                href="/formations"
                className="!border-white/20 !bg-transparent !text-white hover:!border-white/40 hover:!bg-white/5"
              >
                Toutes mes formations
              </LienSobre>
            </div>
          </div>
        </Panneau>
      ) : (
        <Vide
          titre="Vous n'avez pas encore de formation"
          texte="Parcourez le catalogue de votre organisation et inscrivez-vous à une formation publiée pour commencer."
          action={<LienOr href="/catalogue">Parcourir le catalogue</LienOr>}
        />
      )}

      {/* ---------- Chiffres ---------- */}
      <dl className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Chiffre
          valeur={enCours.length}
          libelle="En cours"
          detail={
            terminees.length > 0
              ? `${terminees.length} terminée${terminees.length > 1 ? "s" : ""}`
              : "formations suivies"
          }
          href="/formations"
        />
        <Chiffre
          valeur={(leconsFaites ?? []).length}
          libelle="Leçons"
          detail="terminées à ce jour"
        />
        <Chiffre
          valeur={nbCompetencesAcquises}
          libelle="Compétences"
          detail="avec un niveau attribué"
          href="/progression"
        />
        <Chiffre
          valeur={nbCertificats ?? 0}
          libelle="Certificats"
          detail="valides et vérifiables"
          href="/certificats"
        />
      </dl>

      {/* ---------- Deux colonnes : révision et session ---------- */}
      <div className="mt-8 grid gap-4 lg:grid-cols-2">
        <Panneau>
          <SectionTitre
            action={
              aRevoir.length > 0 ? (
                <Etiquette ton="alerte">{aRevoir.length} à revoir</Etiquette>
              ) : (
                <Etiquette ton="succes">à jour</Etiquette>
              )
            }
          >
            Ma révision
          </SectionTitre>
          {aRevoir.length > 0 ? (
            <>
              <p className="text-sm leading-relaxed text-slate-600">
                {aRevoir.length === 1
                  ? "Une question est restée fausse à votre dernier essai."
                  : `${aRevoir.length} questions sont restées fausses à vos derniers essais.`}{" "}
                Chacune est reprise avec son explication.
              </p>
              <div className="mt-4">
                <LienSobre href="/revision">Réviser maintenant</LienSobre>
              </div>
            </>
          ) : (
            <p className="text-sm leading-relaxed text-slate-600">
              Rien à retravailler pour l&apos;instant : vos dernières
              tentatives sont toutes justes.
            </p>
          )}
        </Panneau>

        <Panneau>
          <SectionTitre>Session présentielle</SectionTitre>
          <p className="text-sm leading-relaxed text-slate-600">
            Votre formateur anime un atelier ? Rejoignez sa session avec le
            code ou le QR code affiché en salle.
          </p>
          <div className="mt-4">
            <LienSobre href="/rejoindre">Rejoindre une session</LienSobre>
          </div>
        </Panneau>
      </div>

      {/* ---------- Formations en cours ---------- */}
      {enCours.length > 0 ? (
        <section className="mt-10">
          <SectionTitre
            compte={enCours.length}
            action={<LienSobre href="/catalogue">Catalogue</LienSobre>}
          >
            Mes formations en cours
          </SectionTitre>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {enCours.slice(0, 6).map((l) => (
              <PanneauLien key={l.course.id} href={`/formations/${l.course.id}`}>
                <h3 className="font-display text-base font-semibold text-ink-900">
                  {l.course.title}
                </h3>
                {/* Un décompte, pas une barre : le total de leçons d'une
                    formation demande deux requêtes de plus par carte, et
                    afficher une jauge sans connaître le total reviendrait
                    à inventer un pourcentage. Le taux exact est sur la
                    fiche de la formation et dans « Mes formations ». */}
                <p className="mt-3 text-sm text-slate-500">
                  {compteLecons(faitesParCours.get(l.course.id) ?? 0)}
                </p>
              </PanneauLien>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------
   Tableau de bord du formateur
   ------------------------------------------------------------------ */

/**
 * Ce qu'un formateur veut savoir en arrivant : ai-je une session
 * ouverte en ce moment (et quel est son code, puisqu'il doit
 * l'annoncer en salle), et qu'est-ce qui est remonté depuis.
 */
async function VueFormateur({
  userId,
  prenom,
}: {
  userId: string;
  prenom: string;
}) {
  const supabase = await createClient();

  const { data: sessions } = await supabase
    .from("live_sessions")
    .select(
      "id, title, session_code, status, starts_at, created_at, course:courses(title)"
    )
    .eq("trainer_id", userId)
    .order("created_at", { ascending: false })
    .limit(30);

  const liste = (sessions ?? []).map((s) => {
    const course = Array.isArray(s.course) ? s.course[0] : s.course;
    return {
      id: s.id as string,
      titre: s.title as string,
      code: s.session_code as string,
      statut: s.status as string,
      formation: course?.title ?? null,
      date: (s.starts_at as string) ?? (s.created_at as string),
    };
  });

  const ouvertes = liste.filter((s) => s.statut === "open");
  const idsSessions = liste.map((s) => s.id);

  const { data: participations } =
    idsSessions.length > 0
      ? await supabase
          .from("session_participants")
          .select("session_id, user_id")
          .in("session_id", idsSessions)
      : { data: [] as Array<Record<string, unknown>> };

  const apprenantsDistincts = new Set(
    (participations ?? []).map((p) => p.user_id as string)
  ).size;

  const enCours = ouvertes[0] ?? null;

  return (
    <div>
      <EcranTitre
        eyebrow="Espace formateur"
        intro="Ouvrez une session, affichez son code en salle, et suivez les réponses en direct."
      >
        Bonjour{prenom ? ` ${prenom}` : ""}
      </EcranTitre>

      {/* Session ouverte : le code est l'information la plus urgente,
          il est donc en très grand et en monospace — un formateur le
          lit à voix haute depuis le fond de la salle. */}
      {enCours ? (
        <Panneau ton="encre" className="relative overflow-hidden !p-0">
          <div className="relative flex flex-col gap-6 p-6 sm:p-7 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0">
              <p className="text-sm font-medium text-brand-200">
                Session ouverte
              </p>
              <h2 className="mt-2 font-display text-xl font-semibold text-white sm:text-2xl">
                {enCours.titre}
              </h2>
              {enCours.formation ? (
                <p className="mt-1 text-sm text-white/50">{enCours.formation}</p>
              ) : null}
              <p className="mt-5 font-mono text-3xl font-semibold tracking-[0.25em] text-white sm:text-4xl">
                {enCours.code}
              </p>
              <p className="mt-1.5 text-xs text-white/40">
                Code à annoncer ou à afficher en salle
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              <LienOr
                href={`/sessions/${enCours.id}`}
                className="!bg-white !text-brand-900 hover:!bg-brand-50"
              >
                Piloter la session
              </LienOr>
              <LienSobre
                href="/sessions"
                className="!border-white/20 !bg-transparent !text-white hover:!border-white/40 hover:!bg-white/5"
              >
                Toutes mes sessions
              </LienSobre>
            </div>
          </div>
        </Panneau>
      ) : (
        <Vide
          titre="Aucune session ouverte"
          texte="Créez une session : les participants la rejoignent avec un code ou un QR code, et vous voyez leurs réponses arriver en direct."
          action={<LienOr href="/sessions">Créer une session</LienOr>}
        />
      )}

      <dl className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Chiffre
          valeur={ouvertes.length}
          libelle="Ouvertes"
          detail="en ce moment"
          href="/sessions"
        />
        <Chiffre
          valeur={liste.length}
          libelle="Sessions"
          detail="animées à ce jour"
          href="/sessions"
        />
        <Chiffre
          valeur={apprenantsDistincts}
          libelle="Apprenants"
          detail="rencontrés, sans doublon"
          href="/groupes"
        />
        <Chiffre
          valeur={liste.filter((s) => s.statut === "closed").length}
          libelle="Clôturées"
          detail="résultats consultables"
          href="/resultats"
        />
      </dl>

      <div className="mt-8 grid gap-4 lg:grid-cols-2">
        <Panneau>
          <SectionTitre>Résultats</SectionTitre>
          <p className="text-sm leading-relaxed text-slate-600">
            Où le groupe bute, qui décroche, et quelles compétences restent
            fragiles — formation par formation.
          </p>
          <div className="mt-4">
            <LienSobre href="/resultats">Analyser une formation</LienSobre>
          </div>
        </Panneau>
        <Panneau>
          <SectionTitre>Mes groupes</SectionTitre>
          <p className="text-sm leading-relaxed text-slate-600">
            Les apprenants rencontrés en session, et ceux qui reviennent
            d&apos;une séance à l&apos;autre.
          </p>
          <div className="mt-4">
            <LienSobre href="/groupes">Voir mes groupes</LienSobre>
          </div>
        </Panneau>
      </div>

      {liste.length > 0 ? (
        <section className="mt-10">
          <SectionTitre
            compte={liste.length}
            action={<LienSobre href="/sessions">Toutes les sessions</LienSobre>}
          >
            Sessions récentes
          </SectionTitre>
          <Panneau flush>
            <ul className="divide-y divide-sand-200">
              {liste.slice(0, 6).map((s) => (
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
                              })
                            : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    </div>
                    <Etiquette ton={s.statut === "open" ? "succes" : "neutre"}>
                      {SESSION_STATUS_LABELS[s.statut] ?? s.statut}
                    </Etiquette>
                  </Link>
                </li>
              ))}
            </ul>
          </Panneau>
        </section>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------
   Vue des rôles dont les écrans ne sont pas encore repris
   ------------------------------------------------------------------ */

function VueRoleNonApprenant({
  prenom,
  role,
  admin,
  organisations,
}: {
  prenom: string;
  role: Parameters<typeof navigationFor>[0];
  admin: boolean;
  organisations: Array<{ id: string; nom: string; role: string }>;
}) {
  /* La navigation du rôle sert de sommaire : elle est déjà calculée
     ailleurs, autant s'en servir plutôt que de tenir une seconde liste
     qui finirait par diverger. */
  const raccourcis = navigationFor(role).filter((n) => n.href !== "/accueil");

  return (
    <div>
      <EcranTitre eyebrow={ROLE_LABELS[role]}>
        Bonjour{prenom ? ` ${prenom}` : ""}
      </EcranTitre>

      <div className="grid gap-4 sm:grid-cols-2">
        <Panneau>
          <SectionTitre>Votre rôle</SectionTitre>
          <p className="font-display text-xl font-semibold text-ink-900">
            {ROLE_LABELS[role]}
          </p>
          {admin ? (
            <p className="mt-1 text-sm text-slate-500">
              Administrateur de la plateforme Elite Experience
            </p>
          ) : null}
        </Panneau>

        <Panneau>
          <SectionTitre>Vos organisations</SectionTitre>
          {organisations.length === 0 ? (
            <p className="text-sm text-slate-500">
              Vous n&apos;êtes rattaché à aucune organisation pour le moment.
            </p>
          ) : (
            <ul className="space-y-2">
              {organisations.map((o) => (
                <li key={o.id} className="flex flex-wrap items-center gap-2">
                  <span className="text-sm text-ink-900">{o.nom}</span>
                  <Etiquette>{o.role}</Etiquette>
                </li>
              ))}
            </ul>
          )}
        </Panneau>
      </div>

      <section className="mt-8">
        <SectionTitre>Vos espaces</SectionTitre>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {raccourcis.map((r) => (
            <PanneauLien key={r.href} href={r.href}>
              <p className="font-display text-base font-semibold text-ink-900">
                {r.label}
              </p>
            </PanneauLien>
          ))}
        </div>
      </section>
    </div>
  );
}

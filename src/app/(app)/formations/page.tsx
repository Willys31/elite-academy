import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/profile";
import {
  activeMemberships,
  isEliteAdmin,
  primaryRole,
  type MemberRole,
} from "@/lib/auth/roles";
import { calculerCompletion } from "@/lib/courses/progression";
import {
  ENROLLMENT_STATUS_LABELS,
  STATUTS_AVEC_ACCES,
} from "@/lib/courses/inscriptions";
import { STATUS_LABELS, type CourseStatus } from "@/lib/courses/statuts";
import {
  indexerAnimations,
  ORIGINE_LABELS,
  resoudreFormationsAnimees,
  type OrigineAnimation,
} from "@/lib/courses/affectations";
import { Alert } from "@/components/ui";
import { EcranTitre, Etiquette, Jauge, LienOr, LienSobre, Panneau, PanneauLien, Retour, SectionTitre, Vide } from "@/components/app";

export const metadata: Metadata = { title: "Mes formations" };

/**
 * « Mes formations » n'a pas le même sens selon qui regarde.
 *
 * - Apprenant : les formations AUXQUELLES IL EST INSCRIT, avec sa
 *   progression. C'est la vue historique de cet écran.
 * - Encadrant (formateur, concepteur, responsable, administrateur) :
 *   les formations QU'IL ANIME. Un formateur ne s'inscrit pas à ses
 *   propres formations ; lui servir la liste de ses inscriptions
 *   revenait à lui montrer un écran vide et à lui proposer de
 *   s'inscrire, ce qui n'a aucun sens.
 *
 * Le rôle principal (`primaryRole`) décide de la vue, exactement comme
 * il décide de la navigation : les deux restent ainsi cohérents.
 */
export default async function MesFormationsPage({
  searchParams,
}: {
  searchParams: Promise<{ desinscrit?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/connexion");
  const params = await searchParams;

  const role = primaryRole(user.memberships);

  if (role !== "learner") {
    return (
      <VueEncadrant
        userId={user.id}
        role={role}
        elite={isEliteAdmin(user.memberships)}
        orgs={activeMemberships(user.memberships)
          .filter((m) =>
            ["admin", "designer", "trainer", "manager"].includes(m.role)
          )
          .map((m) => m.organization_id)}
      />
    );
  }

  return <VueApprenant userId={user.id} desinscrit={Boolean(params.desinscrit)} />;
}

/* ==================================================================
   Vue de l'encadrant : les formations qu'il anime
   ================================================================== */

async function VueEncadrant({
  userId,
  role,
  elite,
  orgs,
}: {
  userId: string;
  role: MemberRole;
  elite: boolean;
  orgs: string[];
}) {
  const supabase = await createClient();

  if (!elite && orgs.length === 0) {
    return (
      <div>
        <EnTeteEncadrant role={role} />
        <Vide
          titre="Aucune organisation rattachée"
          texte="Vous n'encadrez aucune organisation pour le moment. Demandez à votre administrateur de vérifier votre rattachement."
          action={<LienSobre href="/accueil">Retour au tableau de bord</LienSobre>}
        />
      </div>
    );
  }

  let requete = supabase
    .from("courses")
    .select(
      "id, title, description, status, organization_id, owner_id, organization:organizations(name)"
    )
    .order("updated_at", { ascending: false });
  if (!elite) requete = requete.in("organization_id", orgs);
  const { data: formations } = await requete;

  const ids = (formations ?? []).map((f) => f.id as string);

  /* Trois faits rattachent un formateur à une formation : il l'a
     conçue, on l'y a affecté, ou il y a animé une session. La
     migration 0010 a ajouté le deuxième, qui manquait — c'est lui qui
     obligeait auparavant un formateur à s'INSCRIRE pour exister
     quelque part. Voir lib/courses/affectations.ts. */
  const formateurSeul = role === "trainer";
  let requeteSessions = supabase
    .from("live_sessions")
    .select("id, course_id, status, trainer_id");
  if (ids.length > 0) requeteSessions = requeteSessions.in("course_id", ids);
  if (formateurSeul) requeteSessions = requeteSessions.eq("trainer_id", userId);

  const [{ data: sessions }, { data: inscriptions }, { data: affectations }] =
    await Promise.all([
      ids.length > 0
        ? requeteSessions
        : Promise.resolve({ data: [] as Array<Record<string, unknown>> }),
      ids.length > 0
        ? supabase.from("enrollments").select("course_id, status").in("course_id", ids)
        : Promise.resolve({ data: [] as Array<Record<string, unknown>> }),
      supabase
        .from("course_trainers")
        .select("course_id")
        .eq("user_id", userId),
    ]);

  /* Un responsable ou un administrateur n'anime pas : il pilote. Pour
     eux, « animée » garde son sens d'organisation — la formation a
     tourné au moins une fois — et l'affectation personnelle ne
     s'applique pas. */
  const animations = indexerAnimations(
    resoudreFormationsAnimees({
      conception: (formations ?? [])
        .filter((f) => f.owner_id === userId)
        .map((f) => f.id as string),
      affectation: formateurSeul
        ? (affectations ?? []).map((a) => a.course_id as string)
        : [],
      session: (sessions ?? [])
        .filter((s) => !formateurSeul || s.trainer_id === userId)
        .map((s) => (s.course_id as string) ?? ""),
    })
  );

  const sessionsParCours = new Map<string, { total: number; ouvertes: number }>();
  for (const s of sessions ?? []) {
    const cid = s.course_id as string | null;
    if (!cid) continue;
    const e = sessionsParCours.get(cid) ?? { total: 0, ouvertes: 0 };
    e.total += 1;
    if (s.status === "open") e.ouvertes += 1;
    sessionsParCours.set(cid, e);
  }

  const apprenantsParCours = new Map<string, number>();
  for (const i of inscriptions ?? []) {
    const cid = i.course_id as string;
    if (!STATUTS_AVEC_ACCES.includes(i.status as "active" | "completed")) continue;
    apprenantsParCours.set(cid, (apprenantsParCours.get(cid) ?? 0) + 1);
  }

  const lignes = (formations ?? []).map((f) => {
    const org = Array.isArray(f.organization) ? f.organization[0] : f.organization;
    const s = sessionsParCours.get(f.id as string) ?? { total: 0, ouvertes: 0 };
    return {
      id: f.id as string,
      titre: f.title as string,
      description: (f.description as string) ?? null,
      statut: f.status as CourseStatus,
      organisation: org?.name ?? "",
      sessions: s.total,
      sessionsOuvertes: s.ouvertes,
      apprenants: apprenantsParCours.get(f.id as string) ?? 0,
      origine: animations.get(f.id as string)?.origine ?? null,
    };
  });

  /* Pour un formateur, « les miennes » = celles où un lien existe
     (conception, affectation, session). Pour un responsable ou un
     administrateur, qui voit tout son catalogue, on garde le critère
     d'organisation : la formation a-t-elle déjà tourné ? */
  const animees = formateurSeul
    ? lignes.filter((l) => l.origine !== null)
    : lignes.filter((l) => l.sessions > 0);
  const autres = lignes.filter((l) => !animees.includes(l));

  return (
    <div>
      <Retour href="/accueil" />
      <EnTeteEncadrant role={role} />

      {lignes.length === 0 ? (
        <Vide
          titre="Aucune formation dans votre organisation"
          texte="Dès qu'une formation sera créée pour votre organisation, elle apparaîtra ici et vous pourrez ouvrir une session dessus."
          action={<LienOr href="/catalogue">Ouvrir le catalogue</LienOr>}
        />
      ) : (
        <>
          {animees.length > 0 ? (
            <section>
              {/* Pas d'action ici : l'en-tête de l'écran en porte déjà deux,
                  une troisième juste en dessous empilait trois boutons dans
                  la même colonne de droite. */}
              <SectionTitre compte={animees.length}>
                {formateurSeul ? "Formations que j'anime" : "Formations animées"}
              </SectionTitre>
              <GrilleEncadrant lignes={animees} />
            </section>
          ) : null}

          {autres.length > 0 ? (
            <section className={animees.length > 0 ? "mt-10" : ""}>
              <SectionTitre compte={autres.length}>
                {animees.length > 0
                  ? "Autres formations de l'organisation"
                  : "Formations de votre organisation"}
              </SectionTitre>
              <p className="-mt-2 mb-4 text-sm text-slate-500">
                {formateurSeul
                  ? "Vous n'êtes pas rattaché à ces formations : ni conçues par vous, ni affectées, ni animées en session. Votre responsable peut vous y affecter."
                  : "Aucune session n'a encore été animée sur ces formations."}
              </p>
              <GrilleEncadrant lignes={autres} />
            </section>
          ) : null}

          <Panneau className="mt-10">
            <SectionTitre>Comment cette liste est construite</SectionTitre>
            <p className="text-sm leading-relaxed text-slate-600">
              Une formation vous est rattachée pour l&apos;une de trois
              raisons : vous l&apos;avez conçue, votre responsable vous y a
              affecté, ou vous y avez animé une session. Chaque carte indique
              laquelle. Vous n&apos;avez jamais à vous <em>inscrire</em> à une
              formation que vous animez — l&apos;inscription, c&apos;est le
              lien de l&apos;apprenant.
            </p>
          </Panneau>
        </>
      )}
    </div>
  );
}

function EnTeteEncadrant({ role }: { role: MemberRole }) {
  return (
    <EcranTitre
      eyebrow="Vue formateur"
      intro={
        role === "trainer"
          ? "Les formations sur lesquelles vous intervenez, avec le nombre de sessions que vous y avez animées et d'apprenants inscrits."
          : "Les formations de votre organisation, avec leurs sessions et leurs apprenants."
      }
      action={
        <>
          <LienSobre href="/sessions">Ouvrir une session</LienSobre>
          <LienSobre href="/catalogue">Catalogue</LienSobre>
        </>
      }
    >
      Mes formations
    </EcranTitre>
  );
}

function GrilleEncadrant({
  lignes,
}: {
  lignes: Array<{
    id: string;
    titre: string;
    description: string | null;
    statut: CourseStatus;
    organisation: string;
    sessions: number;
    sessionsOuvertes: number;
    apprenants: number;
    origine: OrigineAnimation | null;
  }>;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {lignes.map((l) => (
        <PanneauLien
          key={l.id}
          href={`/resultats?formation=${l.id}`}
          className="flex h-full flex-col"
        >
          <div className="flex items-start justify-between gap-3">
            <h3 className="min-w-0 font-display text-base font-semibold text-ink-900">
              {l.titre}
            </h3>
            <Etiquette ton={l.statut === "published" ? "succes" : "neutre"}>
              {STATUS_LABELS[l.statut] ?? l.statut}
            </Etiquette>
          </div>

          <p className="mt-1 text-xs text-slate-400">
            {/* Dire POURQUOI la formation est là : sans ça, on ne sait pas
                si on la voit parce qu'on y a été désigné ou parce qu'on a
                improvisé un atelier dessus l'an dernier. */}
            {[l.origine ? ORIGINE_LABELS[l.origine] : null, l.organisation]
              .filter(Boolean)
              .join(" · ")}
          </p>

          {l.description ? (
            <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-slate-500">
              {l.description}
            </p>
          ) : null}

          {/* Deux chiffres, alignés en bas de carte : combien de fois la
              formation a été animée, et combien d'apprenants y sont
              rattachés. C'est ce qu'un formateur regarde en premier. */}
          <dl className="mt-auto grid grid-cols-2 gap-3 border-t border-sand-200 pt-4">
            <div>
              <dt className="text-xs font-medium text-slate-400">
                Sessions
              </dt>
              <dd className="mt-0.5 font-display text-lg font-semibold text-ink-900">
                {l.sessions}
                {l.sessionsOuvertes > 0 ? (
                  <span className="ml-2 align-middle text-xs font-medium text-emerald-700">
                    {l.sessionsOuvertes} ouverte
                    {l.sessionsOuvertes > 1 ? "s" : ""}
                  </span>
                ) : null}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-slate-400">
                Apprenants
              </dt>
              <dd className="mt-0.5 font-display text-lg font-semibold text-ink-900">
                {l.apprenants}
              </dd>
            </div>
          </dl>
        </PanneauLien>
      ))}
    </div>
  );
}

/* ==================================================================
   Vue de l'apprenant : les formations auxquelles il est inscrit
   ================================================================== */

async function VueApprenant({
  userId,
  desinscrit,
}: {
  userId: string;
  desinscrit: boolean;
}) {
  const supabase = await createClient();
  const { data: inscriptions } = await supabase
    .from("enrollments")
    .select(
      "id, status, started_at, completed_at, course:courses(id, title, description, current_version_id)"
    )
    .eq("user_id", userId)
    // Les formations quittées sortent de la liste ; leur ligne reste en
    // base pour permettre la reprise (voir lib/courses/inscriptions).
    .in("status", [...STATUTS_AVEC_ACCES])
    .order("created_at", { ascending: false });

  // Complétion par formation : leçons terminées / total.
  const { data: progres } = await supabase
    .from("progress_records")
    .select("course_id, lesson_id")
    .eq("user_id", userId)
    .not("lesson_id", "is", null);

  const faitesParCours = new Map<string, number>();
  for (const p of progres ?? []) {
    faitesParCours.set(p.course_id, (faitesParCours.get(p.course_id) ?? 0) + 1);
  }

  const lignes = await Promise.all(
    (inscriptions ?? []).map(async (i) => {
      const course = Array.isArray(i.course) ? i.course[0] : i.course;
      if (!course) return null;
      let total = 0;
      if (course.current_version_id) {
        const { data: modules } = await supabase
          .from("modules")
          .select("id")
          .eq("course_version_id", course.current_version_id);
        const idsModules = (modules ?? []).map((m) => m.id);
        if (idsModules.length > 0) {
          const { count } = await supabase
            .from("lessons")
            .select("id", { count: "exact", head: true })
            .in("module_id", idsModules);
          total = count ?? 0;
        }
      }
      return {
        id: i.id,
        statut: i.status,
        course,
        faites: faitesParCours.get(course.id) ?? 0,
        total,
        completion: calculerCompletion(faitesParCours.get(course.id) ?? 0, total),
      };
    })
  );
  const affichees = lignes.filter(Boolean) as NonNullable<
    (typeof lignes)[number]
  >[];

  const enCours = affichees.filter((l) => l.statut !== "completed");
  const terminees = affichees.filter((l) => l.statut === "completed");

  return (
    <div>
      <EcranTitre
        eyebrow="Votre parcours"
        intro="Une formation est terminée quand toutes ses leçons le sont. Vous gardez l'accès à son contenu ensuite."
        action={<LienSobre href="/catalogue">Parcourir le catalogue</LienSobre>}
      >
        Mes formations
      </EcranTitre>

      {desinscrit ? (
        <div className="mb-6">
          <Alert kind="success">
            Vous êtes désinscrit. Votre progression est conservée : vous
            pouvez vous réinscrire à tout moment depuis la fiche de la
            formation.
          </Alert>
        </div>
      ) : null}

      {affichees.length === 0 ? (
        <Vide
          titre="Aucune formation en cours"
          texte="Inscrivez-vous à une formation publiée depuis le catalogue de votre organisation."
          action={<LienOr href="/catalogue">Parcourir le catalogue</LienOr>}
        />
      ) : (
        <>
          {enCours.length > 0 ? (
            <section>
              <SectionTitre compte={enCours.length}>En cours</SectionTitre>
              <GrilleApprenant lignes={enCours} />
            </section>
          ) : null}

          {terminees.length > 0 ? (
            <section className={enCours.length > 0 ? "mt-10" : ""}>
              <SectionTitre compte={terminees.length}>Terminées</SectionTitre>
              <GrilleApprenant lignes={terminees} />
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}

function GrilleApprenant({
  lignes,
}: {
  lignes: Array<{
    id: string;
    statut: string;
    course: { id: string; title: string; description: string | null };
    faites: number;
    total: number;
    completion: number;
  }>;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {lignes.map((l) => (
        <PanneauLien
          key={l.id}
          href={`/formations/${l.course.id}`}
          className="flex h-full flex-col"
        >
          <div className="flex items-start justify-between gap-3">
            <h3 className="min-w-0 font-display text-base font-semibold text-ink-900">
              {l.course.title}
            </h3>
            <Etiquette ton={l.statut === "completed" ? "or" : "neutre"}>
              {ENROLLMENT_STATUS_LABELS[l.statut] ?? l.statut}
            </Etiquette>
          </div>

          {l.course.description ? (
            <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-slate-500">
              {l.course.description}
            </p>
          ) : null}

          {/* `mt-auto` colle la jauge au bas de la carte : dans une grille,
              des descriptions de longueurs différentes désalignaient les
              barres d'une carte à l'autre. */}
          <div className="mt-auto pt-5">
            <Jauge
              pourcent={l.completion}
              libelle={
                l.total > 0
                  ? `${l.faites} / ${l.total} leçons · ${l.completion} %`
                  : "Contenu en préparation"
              }
            />
          </div>
        </PanneauLien>
      ))}
    </div>
  );
}

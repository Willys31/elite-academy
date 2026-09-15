import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/profile";
import { activeMemberships, isEliteAdmin } from "@/lib/auth/roles";
import { NIVEAU_CALCULE_LABELS } from "@/lib/courses/progression";
import {
  moyenneGroupe,
  syntheseParActivite,
  syntheseParApprenant,
  type LigneTentative,
} from "@/lib/resultats/resultats";
import { TableScroll } from "@/components/ui";
import { Chiffre, EcranTitre, Etiquette, LienSobre, Panneau, Retour, SectionTitre, Vide } from "@/components/app";

export const metadata: Metadata = { title: "Résultats" };

/** Couleur d'un score : seuils alignés sur le barème de maîtrise. */
function tonScore(score: number): "alerte" | "neutre" | "succes" | "or" {
  if (score < 50) return "alerte";
  if (score < 75) return "neutre";
  if (score < 90) return "succes";
  return "or";
}

/**
 * Résultats.
 *
 * L'écran répond à deux questions dans cet ordre : « sur quoi le groupe
 * bute-t-il ? » puis « qui décroche ? ». Les activités sont donc classées
 * de la plus faible moyenne à la plus forte, et les apprenants de même —
 * un tri alphabétique obligerait le formateur à lire toute la liste pour
 * trouver ce qui mérite son attention.
 *
 * Les scores affichés sont les MEILLEURS essais de chaque apprenant, pas
 * la moyenne de ses tentatives : un apprenant qui retente et progresse ne
 * doit pas tirer le groupe vers le bas.
 */
export default async function ResultatsPage({
  searchParams,
}: {
  searchParams: Promise<{ formation?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/connexion");
  const params = await searchParams;

  const actives = activeMemberships(user.memberships);
  const elite = isEliteAdmin(user.memberships);
  const orgsEncadrees = actives
    .filter((m) => ["admin", "designer", "trainer", "manager"].includes(m.role))
    .map((m) => m.organization_id);

  if (!elite && orgsEncadrees.length === 0) {
    return (
      <div>
        <EnTeteResultats />
        <Vide
          titre="Vous n'encadrez aucune formation"
          texte="Les résultats sont réservés aux formateurs, concepteurs et responsables d'une organisation. Si c'est une erreur, demandez à votre administrateur de vérifier votre rôle."
          action={<LienSobre href="/accueil">Retour au tableau de bord</LienSobre>}
        />
      </div>
    );
  }

  const supabase = await createClient();

  /* Formations encadrées. La RLS filtre déjà ce que l'utilisateur a le
     droit de voir ; le filtre par organisation évite seulement de
     rapatrier le catalogue entier pour un admin Elite Experience. */
  let requeteCours = supabase
    .from("courses")
    .select("id, title, current_version_id, organization:organizations(name)")
    .order("updated_at", { ascending: false });
  if (!elite) requeteCours = requeteCours.in("organization_id", orgsEncadrees);
  const { data: formations } = await requeteCours;

  if (!formations || formations.length === 0) {
    return (
      <div>
        <EnTeteResultats />
        <Vide
          titre="Aucune formation à analyser"
          texte="Dès qu'une formation de votre organisation existe et que des apprenants passent ses QCM, leurs résultats s'affichent ici."
          action={<LienSobre href="/catalogue">Ouvrir le catalogue</LienSobre>}
        />
      </div>
    );
  }

  const choisie =
    formations.find((f) => f.id === params.formation) ?? formations[0];

  /* Descente jusqu'aux activités : version → modules → leçons → activités. */
  let activites: Array<{ id: string; title: string }> = [];
  if (choisie.current_version_id) {
    const { data: modules } = await supabase
      .from("modules")
      .select("id")
      .eq("course_version_id", choisie.current_version_id);
    const idsModules = (modules ?? []).map((m) => m.id);
    if (idsModules.length > 0) {
      const { data: lecons } = await supabase
        .from("lessons")
        .select("id")
        .in("module_id", idsModules);
      const idsLecons = (lecons ?? []).map((l) => l.id);
      if (idsLecons.length > 0) {
        const { data: acts } = await supabase
          .from("activities")
          .select("id, title")
          .in("lesson_id", idsLecons)
          .order("position");
        activites = acts ?? [];
      }
    }
  }

  const idsActivites = activites.map((a) => a.id);
  const [{ data: tentatives }, { data: competences }] = await Promise.all([
    idsActivites.length > 0
      ? supabase
          .from("attempts")
          .select("user_id, activity_id, score")
          .in("activity_id", idsActivites)
      : Promise.resolve({ data: [] as Array<Record<string, unknown>> }),
    supabase
      .from("progress_records")
      .select("user_id, mastery_level, score, competency:competencies(id, name, domain)")
      .eq("course_id", choisie.id)
      .not("competency_id", "is", null),
  ]);

  /* Noms des apprenants. `profiles_select` autorise la lecture des
     profils partageant une organisation : un formateur voit donc bien
     les noms de ses apprenants, et personne d'autre. */
  const idsApprenants = [
    ...new Set((tentatives ?? []).map((t) => t.user_id as string)),
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

  const titresActivites = new Map(activites.map((a) => [a.id, a.title]));
  const lignes: LigneTentative[] = (tentatives ?? []).map((t) => ({
    userId: t.user_id as string,
    nom: noms.get(t.user_id as string) ?? "Apprenant",
    activityId: t.activity_id as string,
    titreActivite: titresActivites.get(t.activity_id as string) ?? "Activité",
    score: t.score === null ? null : Number(t.score),
  }));

  const parActivite = syntheseParActivite(lignes);
  const parApprenant = syntheseParApprenant(lignes);
  const moyenne = moyenneGroupe(lignes);

  /* Compétences les plus fragiles du groupe : moyenne des scores de
     maîtrise, toutes personnes confondues. */
  const parCompetence = new Map<
    string,
    { nom: string; domaine: string; scores: number[]; sansNiveau: number }
  >();
  for (const c of competences ?? []) {
    const comp = Array.isArray(c.competency) ? c.competency[0] : c.competency;
    if (!comp) continue;
    const entree = parCompetence.get(comp.id as string) ?? {
      nom: comp.name as string,
      domaine: (comp.domain as string) ?? "",
      scores: [],
      sansNiveau: 0,
    };
    if (c.score !== null) entree.scores.push(Number(c.score));
    if (!c.mastery_level) entree.sansNiveau += 1;
    parCompetence.set(comp.id as string, entree);
  }
  const competencesFragiles = [...parCompetence.values()]
    .map((c) => ({
      ...c,
      moyenne:
        c.scores.length === 0
          ? null
          : Math.round(c.scores.reduce((a, b) => a + b, 0) / c.scores.length),
    }))
    .sort((a, b) => (a.moyenne ?? 101) - (b.moyenne ?? 101))
    .slice(0, 6);

  return (
    <div>
      <Retour href="/accueil" />
      <EnTeteResultats />

      {/* ---------- Choix de la formation ---------- */}
      <Panneau className="mb-6">
        <form method="get" className="flex flex-wrap items-end gap-3">
          <div className="min-w-56 flex-1">
            <label
              htmlFor="formation"
              className="mb-1.5 block text-sm font-medium text-ink-900"
            >
              Formation
            </label>
            <select
              id="formation"
              name="formation"
              defaultValue={choisie.id}
              className="block min-h-11 w-full rounded-xl border border-sand-200 bg-sand-50/60 px-3.5 py-2.5 text-base text-ink-900 outline-none transition duration-200 focus:border-gold-400 focus:bg-white focus:ring-4 focus:ring-gold-300/25 sm:text-sm"
            >
              {formations.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.title}
                </option>
              ))}
            </select>
          </div>
          <button
            type="submit"
            className="inline-flex min-h-11 items-center justify-center rounded-xl border border-sand-200 bg-white px-4 py-2.5 text-sm font-medium text-ink-900 transition duration-200 hover:border-slate-300 hover:bg-sand-50"
          >
            Afficher
          </button>
        </form>
      </Panneau>

      {lignes.length === 0 ? (
        <Vide
          titre="Aucun résultat sur cette formation"
          texte={
            activites.length === 0
              ? "Cette formation ne contient encore aucune activité évaluée. Ajoutez un QCM à une leçon depuis le catalogue."
              : "Les activités existent, mais personne n'y a encore répondu. Les résultats apparaîtront dès la première tentative."
          }
          action={
            <LienSobre href={`/catalogue/${choisie.id}/modifier`}>
              Ouvrir la formation
            </LienSobre>
          }
        />
      ) : (
        <>
          {/* ---------- Chiffres du groupe ---------- */}
          <dl className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Chiffre
              valeur={parApprenant.length}
              libelle="Apprenants"
              detail="ayant au moins répondu"
            />
            <Chiffre
              valeur={parActivite.length}
              libelle="Activités"
              detail={`sur ${activites.length} au programme`}
            />
            <Chiffre
              valeur={moyenne === null ? "—" : `${moyenne} %`}
              libelle="Moyenne"
              detail="sur les meilleurs essais"
            />
            <Chiffre
              valeur={parApprenant.filter((a) => (a.moyenne ?? 100) < 50).length}
              libelle="En difficulté"
              detail="moyenne sous 50 %"
            />
          </dl>

          {/* ---------- Par activité ---------- */}
          <section className="mt-10">
            <SectionTitre compte={parActivite.length}>
              Où le groupe bute
            </SectionTitre>
            <div className="space-y-3">
              {parActivite.map((a) => (
                <Panneau key={a.activityId}>
                  <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
                    <div className="min-w-0">
                      <h3 className="font-display text-base font-semibold text-ink-900">
                        {a.titre}
                      </h3>
                      <p className="mt-0.5 text-xs text-slate-500">
                        {a.nbApprenants} apprenant{a.nbApprenants > 1 ? "s" : ""}
                        {a.nbEnDifficulte > 0
                          ? ` · ${a.nbEnDifficulte} sous 50 %`
                          : ""}
                      </p>
                    </div>
                    <Etiquette ton={a.moyenne === null ? "neutre" : tonScore(a.moyenne)}>
                      {a.moyenne === null ? "—" : `${a.moyenne} %`}
                    </Etiquette>
                  </div>

                  {/* Répartition : quatre barres proportionnelles. Une barre
                      vide reste visible en creux, sinon on ne saurait pas
                      si la tranche est nulle ou absente. */}
                  <div className="mt-4 flex gap-1.5">
                    {a.repartition.map((r) => {
                      const part =
                        a.nbApprenants === 0 ? 0 : (r.nombre / a.nbApprenants) * 100;
                      return (
                        <div key={r.tranche} className="min-w-0 flex-1">
                          <div className="h-1.5 w-full overflow-hidden rounded-full bg-sand-100">
                            <div
                              className="h-full rounded-full bg-brand-600"
                              style={{ width: `${part}%` }}
                            />
                          </div>
                          <p className="mt-1.5 truncate text-[11px] text-slate-400">
                            {r.tranche} · {r.nombre}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                </Panneau>
              ))}
            </div>
          </section>

          {/* ---------- Par apprenant ---------- */}
          <section className="mt-10">
            <SectionTitre compte={parApprenant.length}>Qui décroche</SectionTitre>
            <Panneau flush className="overflow-hidden">
              <TableScroll>
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="border-b border-sand-200 text-left">
                      <th className="px-5 py-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                        Apprenant
                      </th>
                      <th className="px-5 py-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                        Activités
                      </th>
                      <th className="px-5 py-3 text-right text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                        Moyenne
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-sand-200">
                    {parApprenant.map((a) => (
                      <tr key={a.userId}>
                        <td className="px-5 py-3 font-medium text-ink-900">
                          {a.nom}
                        </td>
                        <td className="whitespace-nowrap px-5 py-3 text-slate-500">
                          {a.nbActivites} / {activites.length}
                        </td>
                        <td className="px-5 py-3 text-right">
                          {a.moyenne === null ? (
                            <span className="text-slate-400">—</span>
                          ) : (
                            <Etiquette ton={tonScore(a.moyenne)}>
                              {a.moyenne} %
                            </Etiquette>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableScroll>
            </Panneau>
          </section>

          {/* ---------- Compétences fragiles ---------- */}
          {competencesFragiles.length > 0 ? (
            <section className="mt-10">
              <SectionTitre>Compétences les plus fragiles</SectionTitre>
              <Panneau flush>
                <ul className="divide-y divide-sand-200">
                  {competencesFragiles.map((c) => (
                    <li
                      key={c.nom}
                      className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-5 py-3.5"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-ink-900">{c.nom}</p>
                        <p className="text-xs text-slate-400">
                          {[c.domaine, `${c.sansNiveau} sans niveau attribué`]
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
                      </div>
                      {c.moyenne === null ? (
                        <span className="text-xs text-slate-400">
                          Pas encore mesurée
                        </span>
                      ) : (
                        <Etiquette ton={tonScore(c.moyenne)}>
                          {c.moyenne} %
                        </Etiquette>
                      )}
                    </li>
                  ))}
                </ul>
              </Panneau>
              <p className="mt-3 text-xs leading-relaxed text-slate-500">
                Rappel : le niveau {NIVEAU_CALCULE_LABELS.elite} ne s&apos;attribue
                jamais par le calcul. C&apos;est à vous de l&apos;accorder depuis la
                fiche de l&apos;apprenant quand il sait transmettre la compétence.
              </p>
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}

function EnTeteResultats() {
  return (
    <EcranTitre
      eyebrow="Vue formateur"
      intro="Les scores retenus sont le meilleur essai de chaque apprenant sur chaque activité. Un apprenant qui retente et progresse ne fait donc jamais baisser la moyenne du groupe."
      action={
        <>
          <LienSobre href="/sessions">Mes sessions</LienSobre>
          <LienSobre href="/groupes">Mes groupes</LienSobre>
        </>
      }
    >
      Résultats
    </EcranTitre>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/profile";
import { iaConfiguree, modeSimulation } from "@/lib/ai/client";
import { STATUTS_AVEC_ACCES } from "@/lib/courses/inscriptions";
import { NIVEAU_CALCULE_LABELS } from "@/lib/courses/progression";
import {
  bandeDeBlocage,
  construireRecommandations,
  MAX_GENERATIONS_PAR_JOUR,
  tendance,
  TENDANCE_LABELS,
  TON_BANDE,
  TYPE_AIDE_LABELS,
  TYPE_BLOCAGE_LABELS,
  TYPE_EXERCICE_LABELS,
  typeExerciceRecommande,
  type Bande,
  type TypeAide,
  type TypeBlocage,
  type TypeExercice,
  type CompetenceSuivie,
} from "@/lib/tutorat/blocage";
import { generationsDuJour } from "@/lib/tutorat/moteur";
import { genererExercices } from "@/app/(app)/tutorat/actions";
import { AuthForm } from "@/components/ui/AuthForm";
import { Icone } from "@/components/icons";
import { Alert, CLASSES_CHAMP } from "@/components/ui";
import { Champ, Chiffre, CransMaitrise, EcranTitre, Etiquette, Jauge, LienOr, LienSobre, Panneau, Retour, SectionTitre, Vide } from "@/components/app";

export const metadata: Metadata = { title: "Tutorat IA" };

/**
 * Tableau de bord du tutorat (addendum Tutorat §6.2 et §10.1) : par
 * compétence de la formation, niveau, score de blocage, tendance et
 * types ; exercices personnalisés en attente et terminés ;
 * recommandations ; génération d'exercices ; historique des aides.
 */
export default async function TutoratPage({
  searchParams,
}: {
  searchParams: Promise<{ formation?: string; generes?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/connexion");
  const params = await searchParams;

  const supabase = await createClient();
  const { data: inscriptions } = await supabase
    .from("enrollments")
    .select("course:courses(id, title, course_competencies(competency:competencies(id, name, domain)))")
    .eq("user_id", user.id)
    .in("status", [...STATUTS_AVEC_ACCES])
    .order("created_at", { ascending: false });

  const premier = <T,>(v: T | T[] | null | undefined): T | null =>
    Array.isArray(v) ? (v[0] ?? null) : (v ?? null);

  const formations = (inscriptions ?? [])
    .map((i) => premier(i.course))
    .filter((c): c is NonNullable<typeof c> => Boolean(c))
    .map((c) => ({
      id: c.id as string,
      title: c.title as string,
      competences: ((c.course_competencies ?? []) as Array<{ competency: unknown }>)
        .map((cc) => premier(cc.competency) as { id: string; name: string; domain: string | null } | null)
        .filter((k): k is { id: string; name: string; domain: string | null } => Boolean(k)),
    }));
  const formation = formations.find((f) => f.id === params.formation) ?? formations[0] ?? null;

  if (!formation) {
    return (
      <div>
        <Retour href="/accueil" />
        <EnTete />
        <Vide titre="Aucune formation suivie" texte="Le tuteur travaille compétence par compétence : inscrivez-vous à une formation pour commencer." action={<LienOr href="/catalogue">Parcourir le catalogue</LienOr>} />
      </div>
    );
  }

  const [{ data: scores }, { data: progres }, { data: exercices }, { data: aides }, generationsJour] = await Promise.all([
    supabase.from("competency_blocking_scores").select("competency_id, score, band, blocking_types, history, nb_tentatives, nb_aides, nb_reformulations").eq("user_id", user.id).eq("course_id", formation.id),
    supabase.from("progress_records").select("competency_id, mastery_level, score").eq("user_id", user.id).eq("course_id", formation.id).not("competency_id", "is", null),
    supabase.from("personalized_exercises").select("id, competency_id, exercise_type, difficulty, content, status, score, created_at, completed_at").eq("user_id", user.id).eq("course_id", formation.id).order("created_at", { ascending: false }),
    supabase.from("tutor_help_events").select("id, help_type, response_text, created_at, activity:activities(id, title), competency:competencies(name)").eq("user_id", user.id).eq("course_id", formation.id).order("created_at", { ascending: false }).limit(20),
    generationsDuJour(user.id, ["tutor_exercises"]),
  ]);

  const scorePar = new Map((scores ?? []).map((s) => [s.competency_id as string, s]));
  const niveauPar = new Map((progres ?? []).map((p) => [p.competency_id as string, p]));
  const enAttentePar = new Map<string, number>();
  for (const e of exercices ?? []) {
    if (e.status === "pending") enAttentePar.set(e.competency_id as string, (enAttentePar.get(e.competency_id as string) ?? 0) + 1);
  }

  const suivies: CompetenceSuivie[] = formation.competences.map((c) => {
    const s = scorePar.get(c.id);
    const score = s?.score === null || s?.score === undefined ? null : Number(s.score);
    return {
      competencyId: c.id,
      nom: c.name,
      score,
      bande: bandeDeBlocage(score).bande,
      niveau: (niveauPar.get(c.id)?.mastery_level as string) ?? null,
      exercicesEnAttente: enAttentePar.get(c.id) ?? 0,
      tendance: tendance(((s?.history as number[] | null) ?? []).map(Number)),
    };
  });
  const recommandations = construireRecommandations(suivies);
  const enAlerte = suivies.filter((c) => c.bande === "important" || c.bande === "critique").length;
  const tuteurDisponible = iaConfiguree() || modeSimulation();
  const generationsRestantes = Math.max(0, MAX_GENERATIONS_PAR_JOUR - generationsJour);

  const enAttente = (exercices ?? []).filter((e) => e.status === "pending");
  const termines = (exercices ?? []).filter((e) => e.status === "completed");
  const nomCompetence = (id: string) => formation.competences.find((c) => c.id === id)?.name ?? "Compétence";

  return (
    <div>
      <Retour href="/accueil" />
      <EnTete />

      {params.generes ? (
        <div className="mb-6"><Alert kind="success">{params.generes} exercice{Number(params.generes) > 1 ? "s" : ""} généré{Number(params.generes) > 1 ? "s" : ""} : à vous de jouer.</Alert></div>
      ) : null}
      {!tuteurDisponible ? (
        <div className="mb-6"><Alert kind="info">Le tuteur IA n&apos;est pas configuré (voir .env.example) : le suivi des blocages reste actif, les aides et les exercices générés sont indisponibles.</Alert></div>
      ) : null}

      {/* ---------- Formation ---------- */}
      {formations.length > 1 ? (
        <form method="get" className="mb-6 flex flex-wrap items-end gap-3">
          <label className="min-w-0 flex-1 text-sm font-medium text-ink-900">
            Formation
            <select name="formation" defaultValue={formation.id} className={`${CLASSES_CHAMP} mt-1.5`}>
              {formations.map((f) => <option key={f.id} value={f.id}>{f.title}</option>)}
            </select>
          </label>
          <button type="submit" className="inline-flex min-h-11 items-center rounded-lg border border-sand-300 bg-white px-4 text-sm font-medium text-ink-900 hover:bg-sand-50">Afficher</button>
        </form>
      ) : null}

      <dl className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Chiffre valeur={suivies.length} libelle="Compétences" detail="suivies dans cette formation" />
        <Chiffre valeur={enAlerte} libelle="Blocages" detail="importants ou critiques" />
        <Chiffre valeur={enAttente.length} libelle="Exercices" detail="personnalisés à faire" />
        <Chiffre valeur={termines.length} libelle="Terminés" detail={termines.length > 0 ? `${Math.round(termines.reduce((s, e) => s + Number(e.score ?? 0), 0) / termines.length)} % de moyenne` : "aucun encore"} />
      </dl>

      <div className="mt-8 grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <div className="space-y-8">
          {/* ---------- Par compétence ---------- */}
          <section>
            <SectionTitre compte={suivies.length}>Compétences et blocages</SectionTitre>
            {suivies.length === 0 ? (
              <p className="text-sm text-slate-500">Cette formation n&apos;a pas encore de compétence rattachée.</p>
            ) : (
              <ul className="space-y-3">
                {suivies.map((c) => {
                  const s = scorePar.get(c.competencyId);
                  const bande = bandeDeBlocage(c.score);
                  const types = ((s?.blocking_types as string[] | null) ?? []) as TypeBlocage[];
                  return (
                    <li key={c.competencyId}>
                      <Panneau>
                        <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
                          <div className="min-w-0">
                            <p className="font-semibold text-ink-900">{c.nom}</p>
                            <p className="mt-0.5 flex items-center gap-2 text-xs text-slate-500">
                              <CransMaitrise niveau={c.niveau} />
                              {c.niveau ? NIVEAU_CALCULE_LABELS[c.niveau] : "aucun niveau"}
                              {s ? ` · ${s.nb_tentatives} tentative${Number(s.nb_tentatives) > 1 ? "s" : ""}, ${Number(s.nb_aides) + Number(s.nb_reformulations)} aide${Number(s.nb_aides) + Number(s.nb_reformulations) > 1 ? "s" : ""}` : ""}
                            </p>
                          </div>
                          <Etiquette ton={TON_BANDE[bande.bande as Bande]}>{bande.libelle}</Etiquette>
                        </div>
                        <div className="mt-3">
                          <Jauge pourcent={(c.score ?? 0) * 100} libelle={c.score === null ? "Score de blocage : pas encore de tentative" : `Score de blocage ${c.score} · ${TENDANCE_LABELS[c.tendance]} · ${bande.action}`} />
                        </div>
                        {types.length > 0 ? (
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {types.map((t) => <Etiquette key={t}>{TYPE_BLOCAGE_LABELS[t] ?? t}</Etiquette>)}
                          </div>
                        ) : null}
                        {c.exercicesEnAttente > 0 ? (
                          <p className="mt-2 text-xs font-medium text-brand-700">{c.exercicesEnAttente} exercice{c.exercicesEnAttente > 1 ? "s" : ""} en attente ci-contre.</p>
                        ) : null}
                      </Panneau>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {/* ---------- Exercices ---------- */}
          <section>
            <SectionTitre compte={enAttente.length}>Exercices personnalisés</SectionTitre>
            {enAttente.length === 0 && termines.length === 0 ? (
              <p className="text-sm text-slate-500">Aucun exercice pour l&apos;instant : générez-en depuis une compétence ci-contre.</p>
            ) : (
              <>
                {enAttente.length > 0 ? (
                  <ul className="grid gap-3 sm:grid-cols-2">
                    {enAttente.map((e) => (
                      <li key={e.id}>
                        <Link href={`/tutorat/exercice/${e.id}`} className="block h-full rounded-xl border border-sand-200 bg-white p-4 shadow-[0_1px_2px_rgba(17,20,18,0.04)] transition-[border-color,box-shadow] duration-150 hover:border-sand-300 hover:shadow-[0_6px_20px_-10px_rgba(17,20,18,0.22)]">
                          <div className="flex flex-wrap gap-1.5">
                            <Etiquette ton="or">{TYPE_EXERCICE_LABELS[e.exercise_type as TypeExercice]}</Etiquette>
                            <Etiquette>Difficulté {e.difficulty}/5</Etiquette>
                          </div>
                          <p className="mt-2 font-medium text-ink-900">{(e.content as { title?: string })?.title}</p>
                          <p className="text-xs text-slate-500">{nomCompetence(e.competency_id as string)} · {((e.content as { questions?: unknown[] })?.questions ?? []).length} question(s)</p>
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : null}
                {termines.length > 0 ? (
                  <Panneau flush className="mt-4">
                    <ul className="divide-y divide-sand-100">
                      {termines.slice(0, 10).map((e) => (
                        <li key={e.id}>
                          <Link href={`/tutorat/exercice/${e.id}`} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-5 py-3 text-sm hover:bg-sand-50">
                            <span className="min-w-0">
                              <span className="block font-medium text-ink-900">{(e.content as { title?: string })?.title}</span>
                              <span className="block text-xs text-slate-500">{nomCompetence(e.competency_id as string)} · {TYPE_EXERCICE_LABELS[e.exercise_type as TypeExercice]}</span>
                            </span>
                            <Etiquette ton={Number(e.score) >= 80 ? "succes" : "alerte"}>{Number(e.score)} %</Etiquette>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </Panneau>
                ) : null}
              </>
            )}
          </section>

          {/* ---------- Historique des aides ---------- */}
          {(aides ?? []).length > 0 ? (
            <section>
              <SectionTitre compte={(aides ?? []).length}>Dernières aides du tuteur</SectionTitre>
              <Panneau flush>
                <ul className="divide-y divide-sand-100">
                  {(aides ?? []).map((a) => {
                    const activite = premier(a.activity);
                    const comp = premier(a.competency);
                    return (
                      <li key={a.id} className="px-5 py-3 text-sm">
                        <p className="text-xs font-medium text-slate-500">
                          {TYPE_AIDE_LABELS[a.help_type as TypeAide] ?? a.help_type}
                          {activite?.title ? ` · ${activite.title}` : ""}
                          {comp?.name ? ` · ${comp.name}` : ""} ·{" "}
                          {new Date(a.created_at).toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}
                        </p>
                        <p className="mt-1 line-clamp-3 leading-relaxed text-ink-900">{a.response_text}</p>
                      </li>
                    );
                  })}
                </ul>
              </Panneau>
            </section>
          ) : null}
        </div>

        <div className="space-y-6">
          {/* ---------- Recommandations ---------- */}
          <section>
            <SectionTitre>Recommandations</SectionTitre>
            {recommandations.length === 0 ? (
              <Panneau><p className="text-sm text-slate-600">Rien d&apos;urgent : continuez les leçons et les QCM, le tuteur vous signalera un blocage.</p></Panneau>
            ) : (
              <ul className="space-y-2">
                {recommandations.map((r, i) => (
                  <li key={`${r.type}-${r.competencyId}-${i}`} className="flex gap-3 rounded-xl border border-sand-200 bg-white p-4">
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-700">
                      <Icone nom={r.type === "trainer_meeting" ? "groupe" : r.type === "peer_help" ? "mains" : r.type === "review" ? "revision" : "ampoule"} className="size-4" />
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-ink-900">{r.titre}</p>
                      <p className="text-xs leading-relaxed text-slate-500">{r.detail}</p>
                      {r.type === "peer_help" ? <Link href={`/entraide/nouveau?formation=${formation.id}&competence=${r.competencyId}`} className="mt-1 inline-block text-xs font-medium text-brand-700 hover:underline">Partager dans l&apos;Entraide</Link> : null}
                      {r.type === "review" ? <Link href="/revision" className="mt-1 inline-block text-xs font-medium text-brand-700 hover:underline">Ouvrir ma révision</Link> : null}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* ---------- Générer ---------- */}
          <section>
            <SectionTitre>Générer des exercices</SectionTitre>
            <Panneau>
              {!tuteurDisponible ? (
                <p className="text-sm text-slate-600">Indisponible sans configuration IA.</p>
              ) : formation.competences.length === 0 ? (
                <p className="text-sm text-slate-600">Cette formation n&apos;a pas de compétence rattachée.</p>
              ) : (
                <AuthForm action={genererExercices} submitLabel="Générer" pendingLabel="Génération en cours…">
                  <input type="hidden" name="course_id" value={formation.id} />
                  <div>
                    <Champ htmlFor="competency_id">Compétence</Champ>
                    <select id="competency_id" name="competency_id" required className={CLASSES_CHAMP}>
                      {suivies.map((c) => (
                        <option key={c.competencyId} value={c.competencyId}>
                          {c.nom} — {TYPE_EXERCICE_LABELS[typeExerciceRecommande(c.bande, c.niveau)].toLowerCase()}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <Champ htmlFor="nb" hint={`${generationsRestantes} génération${generationsRestantes > 1 ? "s" : ""} restante${generationsRestantes > 1 ? "s" : ""} aujourd'hui`}>Nombre d&apos;exercices</Champ>
                    <select id="nb" name="nb" className={CLASSES_CHAMP} defaultValue="2">
                      {[1, 2, 3].map((n) => <option key={n} value={n}>{n}</option>)}
                    </select>
                  </div>
                  <p className="text-xs leading-relaxed text-slate-500">Le type d&apos;exercice est choisi d&apos;après votre score de blocage et votre niveau : base, remédiation, consolidation ou challenge.</p>
                </AuthForm>
              )}
            </Panneau>
          </section>

          <Panneau>
            <p className="text-sm font-medium text-ink-900">Trois niveaux d&apos;aide</p>
            <ul className="mt-2 space-y-1.5 text-sm text-slate-600">
              <li className="flex gap-2"><Icone nom="robot" className="mt-0.5 size-4 shrink-0 text-brand-700" /> Le tuteur IA, sur chaque question, 24h/24.</li>
              <li className="flex gap-2"><Icone nom="mains" className="mt-0.5 size-4 shrink-0 text-brand-700" /> Vos pairs, dans l&apos;<Link href="/entraide" className="underline">Entraide</Link>.</li>
              <li className="flex gap-2"><Icone nom="groupe" className="mt-0.5 size-4 shrink-0 text-brand-700" /> Votre formateur, alerté dès qu&apos;un blocage devient important.</li>
            </ul>
            <div className="mt-3"><LienSobre href="/progression">Ma progression</LienSobre></div>
          </Panneau>
        </div>
      </div>
    </div>
  );
}

function EnTete() {
  return (
    <EcranTitre
      eyebrow="Tutorat IA"
      intro="Le tuteur mesure vos blocages compétence par compétence, propose des exercices adaptés et alerte votre formateur quand un blocage devient important. Il aide à comprendre ; il ne donne jamais la réponse."
    >
      Mon tutorat
    </EcranTitre>
  );
}

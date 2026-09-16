import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/profile";
import { activeMemberships, isEliteAdmin } from "@/lib/auth/roles";
import { etiquettePortee, PORTEE_LABELS, PORTEES, porteeValide } from "@/lib/partage/visibilite";
import {
  libelleAuteur,
  SECTEUR_LABELS,
  SECTEURS,
  secteurValide,
  STATUT_SITUATION_LABELS,
  TON_STATUT_SITUATION,
  trierSituations,
  triValide,
  type TriSituations,
} from "@/lib/situations/situations";
import { Icone } from "@/components/icons";
import { Alert, CLASSES_CHAMP } from "@/components/ui";
import { EcranTitre, Etiquette, LienOr, Panneau, Retour, SectionTitre, Vide } from "@/components/app";

export const metadata: Metadata = { title: "Situations de travail" };

/**
 * Bibliothèque des situations de travail (addendum §10.1) : situation
 * de la semaine, file « à valider » pour l'encadrement, filtres par
 * portée / secteur / compétence / formation et tri. La RLS (0015)
 * limite aux situations publiées dans mon périmètre, plus les miennes.
 */
export default async function SituationsPage({
  searchParams,
}: {
  searchParams: Promise<{
    portee?: string;
    secteur?: string;
    competence?: string;
    formation?: string;
    tri?: string;
    retiree?: string;
  }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/connexion");
  const params = await searchParams;

  const encadrant =
    isEliteAdmin(user.memberships) ||
    activeMemberships(user.memberships).some((m) => m.role !== "learner");

  const supabase = await createClient();
  const { data: situations } = await supabase
    .from("work_situations")
    .select(
      "id, user_id, course_id, visibility_scope, sector, title, situation, status, is_anonymized, useful_votes_count, featured_at, created_at, course:courses(title), auteur:profiles!work_situations_user_id_fkey(full_name), competences:situation_competencies(competency:competencies(id, name))"
    )
    .order("created_at", { ascending: false })
    .limit(300);

  const premier = <T,>(v: T | T[] | null | undefined): T | null =>
    Array.isArray(v) ? (v[0] ?? null) : (v ?? null);

  const lignes = (situations ?? []).map((s) => ({
    id: s.id as string,
    user_id: s.user_id as string,
    course_id: s.course_id as string,
    visibility_scope: s.visibility_scope as string,
    sector: s.sector as string,
    title: s.title as string,
    extrait: (s.situation as string).slice(0, 180),
    status: s.status as string,
    useful_votes_count: Number(s.useful_votes_count),
    featured_at: (s.featured_at as string) ?? null,
    created_at: s.created_at as string,
    formation: premier(s.course)?.title ?? null,
    auteur: libelleAuteur({
      isAnonymized: Boolean(s.is_anonymized),
      fullName: premier(s.auteur)?.full_name as string | undefined,
      secteur: s.sector as string,
    }),
    competences: ((s.competences ?? []) as Array<{ competency: unknown }>)
      .map((c) => premier(c.competency) as { id: string; name: string } | null)
      .filter((k): k is { id: string; name: string } => Boolean(k)),
  }));

  const filtres = {
    portee: porteeValide(params.portee) ? params.portee : null,
    secteur: secteurValide(params.secteur) ? params.secteur : null,
    competence: params.competence || null,
    formation: params.formation || null,
  };
  const tri: TriSituations = triValide(params.tri) ? params.tri : "utiles";

  const publiees = lignes.filter((s) => s.status === "validated");
  const filtrees = trierSituations(
    publiees.filter(
      (s) =>
        (!filtres.portee || s.visibility_scope === filtres.portee) &&
        (!filtres.secteur || s.sector === filtres.secteur) &&
        (!filtres.formation || s.course_id === filtres.formation) &&
        (!filtres.competence || s.competences.some((k) => k.id === filtres.competence))
    ),
    tri
  );
  const aValider = encadrant ? lignes.filter((s) => s.status === "submitted" && s.user_id !== user.id) : [];
  const miennes = lignes.filter((s) => s.user_id === user.id && s.status !== "validated");
  const vedette = [...publiees].filter((s) => s.featured_at).sort((a, b) => (b.featured_at! < a.featured_at! ? -1 : 1))[0] ?? null;

  const formations = new Map<string, string>();
  const competences = new Map<string, string>();
  for (const s of publiees) {
    if (s.formation) formations.set(s.course_id, s.formation);
    for (const k of s.competences) competences.set(k.id, k.name);
  }

  return (
    <div>
      <Retour href="/accueil" />
      <EcranTitre
        eyebrow="Communauté"
        intro="Des situations vécues en entreprise, racontées selon un même fil — contexte, situation, résolution, résultat — et validées par un formateur avant publication."
        action={<LienOr href="/situations/nouvelle">Partager une situation</LienOr>}
      >
        Situations de travail
      </EcranTitre>

      {params.retiree ? (
        <div className="mb-6"><Alert kind="success">Situation retirée.</Alert></div>
      ) : null}

      {/* ---------- À valider (encadrement) ---------- */}
      {aValider.length > 0 ? (
        <section className="mb-10">
          <SectionTitre compte={aValider.length}>À valider</SectionTitre>
          <Panneau flush>
            <ul className="divide-y divide-sand-100">
              {aValider.map((s) => (
                <li key={s.id}>
                  <Link href={`/situations/${s.id}`} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-5 py-3.5 transition-colors duration-150 hover:bg-sand-50">
                    <span className="min-w-0">
                      <span className="block font-medium text-ink-900">{s.title}</span>
                      <span className="block text-xs text-slate-500">
                        {s.auteur}{s.formation ? ` · ${s.formation}` : ""} · {new Date(s.created_at).toLocaleDateString("fr-FR", { day: "numeric", month: "long" })}
                      </span>
                    </span>
                    <Etiquette ton="or">À valider</Etiquette>
                  </Link>
                </li>
              ))}
            </ul>
          </Panneau>
        </section>
      ) : null}

      {/* ---------- Mes situations en attente / refusées ---------- */}
      {miennes.length > 0 ? (
        <section className="mb-10">
          <SectionTitre compte={miennes.length}>Mes situations en cours</SectionTitre>
          <Panneau flush>
            <ul className="divide-y divide-sand-100">
              {miennes.map((s) => (
                <li key={s.id}>
                  <Link href={`/situations/${s.id}`} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-5 py-3.5 transition-colors duration-150 hover:bg-sand-50">
                    <span className="font-medium text-ink-900">{s.title}</span>
                    <Etiquette ton={TON_STATUT_SITUATION[s.status] ?? "neutre"}>{STATUT_SITUATION_LABELS[s.status]}</Etiquette>
                  </Link>
                </li>
              ))}
            </ul>
          </Panneau>
        </section>
      ) : null}

      {/* ---------- Situation de la semaine ---------- */}
      {vedette ? (
        <section className="mb-10">
          <SectionTitre>Situation de la semaine</SectionTitre>
          <Link href={`/situations/${vedette.id}`} className="block rounded-xl border border-gold-400/60 bg-gradient-to-br from-white to-gold-300/15 p-6 shadow-[0_1px_2px_rgba(17,20,18,0.05)] transition-[box-shadow] duration-150 hover:shadow-[0_6px_20px_-10px_rgba(17,20,18,0.22)]">
            <p className="text-sm font-medium text-gold-600">Choisie par l&apos;encadrement</p>
            <p className="mt-1 text-xl font-semibold tracking-[-0.02em] text-ink-950">{vedette.title}</p>
            <p className="mt-2 text-sm leading-relaxed text-slate-600">{vedette.extrait}…</p>
            <p className="mt-3 text-xs text-slate-500">{vedette.auteur} · {vedette.useful_votes_count} vote{vedette.useful_votes_count > 1 ? "s" : ""} Utile</p>
          </Link>
        </section>
      ) : null}

      {/* ---------- Filtres ---------- */}
      <form method="get" className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1fr_1fr_auto_auto]">
        <select name="secteur" defaultValue={filtres.secteur ?? ""} className={CLASSES_CHAMP} aria-label="Secteur">
          <option value="">Tous les secteurs</option>
          {SECTEURS.map((s) => <option key={s} value={s}>{SECTEUR_LABELS[s]}</option>)}
        </select>
        <select name="formation" defaultValue={filtres.formation ?? ""} className={CLASSES_CHAMP} aria-label="Formation">
          <option value="">Toutes les formations</option>
          {[...formations.entries()].map(([id, t]) => <option key={id} value={id}>{t}</option>)}
        </select>
        <select name="competence" defaultValue={filtres.competence ?? ""} className={CLASSES_CHAMP} aria-label="Compétence">
          <option value="">Toutes les compétences</option>
          {[...competences.entries()].map(([id, n]) => <option key={id} value={id}>{n}</option>)}
        </select>
        <select name="portee" defaultValue={filtres.portee ?? ""} className={CLASSES_CHAMP} aria-label="Portée">
          <option value="">Toutes les portées</option>
          {PORTEES.map((p) => <option key={p} value={p}>{PORTEE_LABELS[p]}</option>)}
        </select>
        <select name="tri" defaultValue={tri} className={CLASSES_CHAMP} aria-label="Tri">
          <option value="utiles">Plus utiles</option>
          <option value="recentes">Plus récentes</option>
        </select>
        <button type="submit" className="inline-flex min-h-11 items-center justify-center rounded-lg bg-brand-700 px-4 text-sm font-semibold text-white hover:bg-brand-800">
          Filtrer
        </button>
      </form>

      <SectionTitre compte={filtrees.length}>Situations publiées</SectionTitre>
      {filtrees.length === 0 ? (
        <Vide
          titre="Aucune situation publiée"
          texte="Partagez la vôtre : une fois validée par un formateur, elle alimente la base de connaissances de votre formation."
          action={<LienOr href="/situations/nouvelle">Partager une situation</LienOr>}
        />
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {filtrees.map((s) => {
            const portee = etiquettePortee(s.visibility_scope as "group");
            return (
              <li key={s.id}>
                <Link href={`/situations/${s.id}`} className="block h-full rounded-xl border border-sand-200 bg-white p-5 shadow-[0_1px_2px_rgba(17,20,18,0.04)] transition-[border-color,box-shadow] duration-150 hover:border-sand-300 hover:shadow-[0_6px_20px_-10px_rgba(17,20,18,0.22)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600">
                  <div className="flex flex-wrap items-center gap-2">
                    <Etiquette>{secteurValide(s.sector) ? SECTEUR_LABELS[s.sector] : s.sector}</Etiquette>
                    <Etiquette ton={portee.ton}>{portee.libelle}</Etiquette>
                    {s.featured_at ? <Etiquette ton="or">À la une</Etiquette> : null}
                  </div>
                  <p className="mt-3 text-base font-semibold tracking-[-0.01em] text-ink-950">{s.title}</p>
                  <p className="mt-1.5 text-sm leading-relaxed text-slate-600">{s.extrait}…</p>
                  {s.competences.length > 0 ? (
                    <p className="mt-2 text-xs text-slate-500">{s.competences.map((k) => k.name).join(" · ")}</p>
                  ) : null}
                  <p className="mt-3 flex items-center justify-between gap-3 text-xs text-slate-500">
                    <span className="truncate">{s.auteur}</span>
                    <span className="inline-flex shrink-0 items-center gap-1 font-medium text-brand-700">
                      <Icone nom="pouce" className="size-3.5" />
                      {s.useful_votes_count}
                    </span>
                  </p>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

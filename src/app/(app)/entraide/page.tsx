import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/profile";
import { activeMemberships, isEliteAdmin, primaryRole } from "@/lib/auth/roles";
import { STATUTS_AVEC_ACCES } from "@/lib/courses/inscriptions";
import { lirePreferences } from "@/lib/profil/preferences";
import { etiquettePortee, PORTEE_LABELS, PORTEES, porteeValide } from "@/lib/partage/visibilite";
import {
  entraideActive,
  filtrerBlocages,
  libelleAuteurAnonyme,
  STATUT_BLOCAGE_LABELS,
  TON_STATUT_BLOCAGE,
} from "@/lib/entraide/entraide";
import { Icone } from "@/components/icons";
import { Alert, CLASSES_CHAMP } from "@/components/ui";
import { EcranTitre, Etiquette, LienOr, LienSobre, Panneau, Retour, SectionTitre, Vide } from "@/components/app";

export const metadata: Metadata = { title: "Entraide" };

/**
 * Espace Entraide (addendum Entraide §8.1) : points bloquants visibles
 * dans mon périmètre (RLS), filtres par formation / compétence / statut /
 * portée, bouton de partage. Les auteurs ne sont jamais nommés.
 */
export default async function EntraidePage({
  searchParams,
}: {
  searchParams: Promise<{ formation?: string; competence?: string; statut?: string; portee?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/connexion");
  const params = await searchParams;

  const supabase = await createClient();
  const [{ data: profil }, { data: posts }, { data: inscriptions }] = await Promise.all([
    supabase.from("profiles").select("preferences").eq("id", user.id).maybeSingle(),
    supabase
      .from("peer_help_posts")
      .select(
        "id, user_id, course_id, competency_id, visibility_scope, description, status, is_hidden, created_at, course:courses(title), competency:competencies(name), contributions:peer_help_contributions(count)"
      )
      .order("created_at", { ascending: false })
      .limit(200),
    supabase
      .from("enrollments")
      .select("course:courses(id, title)")
      .eq("user_id", user.id)
      .in("status", [...STATUTS_AVEC_ACCES]),
  ]);

  const actif = entraideActive(lirePreferences(profil?.preferences));
  const encadrant =
    isEliteAdmin(user.memberships) ||
    activeMemberships(user.memberships).some((m) => m.role !== "learner");
  const apprenant = primaryRole(user.memberships) === "learner";

  const premier = <T,>(v: T | T[] | null | undefined): T | null =>
    Array.isArray(v) ? (v[0] ?? null) : (v ?? null);

  const lignes = (posts ?? []).map((p) => ({
    id: p.id as string,
    user_id: p.user_id as string,
    course_id: p.course_id as string,
    competency_id: (p.competency_id as string) ?? null,
    visibility_scope: p.visibility_scope as string,
    description: p.description as string,
    status: p.status as string,
    is_hidden: Boolean(p.is_hidden),
    created_at: p.created_at as string,
    formation: premier(p.course)?.title ?? null,
    competence: premier(p.competency)?.name ?? null,
    nbContributions: Number(premier(p.contributions)?.count ?? 0),
  }));

  // Options de filtre : à partir de ce qui est visible + mes inscriptions.
  const formations = new Map<string, string>();
  for (const i of inscriptions ?? []) {
    const c = premier(i.course);
    if (c) formations.set(c.id, c.title);
  }
  for (const l of lignes) if (l.formation) formations.set(l.course_id, l.formation);
  const competences = new Map<string, string>();
  for (const l of lignes) if (l.competency_id && l.competence) competences.set(l.competency_id, l.competence);

  const filtres = {
    formation: params.formation || null,
    competence: params.competence || null,
    statut: ["open", "resolved", "archived"].includes(params.statut ?? "") ? params.statut : null,
    portee: porteeValide(params.portee) ? params.portee : null,
  };
  const visibles = filtrerBlocages(lignes, filtres);
  const nbFiltres = Object.values(filtres).filter(Boolean).length;

  return (
    <div>
      <Retour href="/accueil" />
      <EcranTitre
        eyebrow="Communauté"
        intro="Un point bloquant partagé anonymement, des indices et des méthodes proposés par vos pairs — jamais la réponse directe. L'IA reste le premier niveau d'aide, l'Entraide le second, le formateur le troisième."
        action={
          <>
            {encadrant ? <LienSobre href="/entraide/moderation">Modération</LienSobre> : null}
            {actif ? <LienOr href="/entraide/nouveau">Partager mon blocage</LienOr> : null}
          </>
        }
      >
        Entraide
      </EcranTitre>

      {!actif && apprenant ? (
        <div className="mb-6">
          <Alert kind="info">
            L&apos;Entraide est désactivée sur votre compte. Vous pouvez lire les
            blocages de vos pairs ; pour partager le vôtre ou proposer une aide,{" "}
            <Link href="/profil" className="font-medium underline">
              activez-la dans votre profil
            </Link>
            .
          </Alert>
        </div>
      ) : null}

      {/* ---------- Filtres ---------- */}
      <form method="get" className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_auto_auto_auto]">
        <select name="formation" defaultValue={filtres.formation ?? ""} className={CLASSES_CHAMP} aria-label="Formation">
          <option value="">Toutes les formations</option>
          {[...formations.entries()].map(([id, titre]) => (
            <option key={id} value={id}>{titre}</option>
          ))}
        </select>
        <select name="competence" defaultValue={filtres.competence ?? ""} className={CLASSES_CHAMP} aria-label="Compétence">
          <option value="">Toutes les compétences</option>
          {[...competences.entries()].map(([id, nom]) => (
            <option key={id} value={id}>{nom}</option>
          ))}
        </select>
        <select name="statut" defaultValue={filtres.statut ?? ""} className={CLASSES_CHAMP} aria-label="Statut">
          <option value="">Tous les statuts</option>
          {Object.entries(STATUT_BLOCAGE_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        <select name="portee" defaultValue={filtres.portee ?? ""} className={CLASSES_CHAMP} aria-label="Portée">
          <option value="">Toutes les portées</option>
          {PORTEES.map((p) => (
            <option key={p} value={p}>{PORTEE_LABELS[p]}</option>
          ))}
        </select>
        <div className="flex gap-2">
          <button type="submit" className="inline-flex min-h-11 items-center justify-center rounded-lg bg-brand-700 px-4 text-sm font-semibold text-white hover:bg-brand-800">
            Filtrer
          </button>
          {nbFiltres > 0 ? (
            <Link href="/entraide" className="inline-flex min-h-11 items-center rounded-lg px-3 text-sm font-medium text-slate-600 hover:bg-sand-100">
              Effacer
            </Link>
          ) : null}
        </div>
      </form>

      <SectionTitre compte={visibles.length}>Points bloquants</SectionTitre>
      {visibles.length === 0 ? (
        <Vide
          titre={nbFiltres > 0 ? "Aucun blocage ne correspond à ces filtres" : "Aucun point bloquant pour le moment"}
          texte="Les blocages partagés par les apprenants de vos formations s'afficheront ici."
          action={actif ? <LienOr href="/entraide/nouveau">Partager mon blocage</LienOr> : undefined}
        />
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {visibles.map((b) => {
            const portee = etiquettePortee(b.visibility_scope as "group");
            return (
              <li key={b.id}>
                <Link
                  href={`/entraide/${b.id}`}
                  className="group block h-full rounded-xl border border-sand-200 bg-white p-5 shadow-[0_1px_2px_rgba(17,20,18,0.04)] transition-[border-color,box-shadow] duration-150 hover:border-sand-300 hover:shadow-[0_6px_20px_-10px_rgba(17,20,18,0.22)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Etiquette ton={TON_STATUT_BLOCAGE[b.status] ?? "neutre"}>
                      {STATUT_BLOCAGE_LABELS[b.status] ?? b.status}
                    </Etiquette>
                    <Etiquette ton={portee.ton}>{portee.libelle}</Etiquette>
                    {b.is_hidden ? <Etiquette ton="alerte">Masqué</Etiquette> : null}
                    {b.user_id === user.id ? <Etiquette>Le vôtre</Etiquette> : null}
                  </div>
                  <p className="mt-3 text-[15px] leading-relaxed text-ink-900">{b.description}</p>
                  <p className="mt-3 text-xs text-slate-500">
                    {libelleAuteurAnonyme(b.formation)}
                    {b.competence ? ` · ${b.competence}` : ""} ·{" "}
                    {new Date(b.created_at).toLocaleDateString("fr-FR", { day: "numeric", month: "long" })}
                  </p>
                  <p className="mt-2 flex items-center gap-1.5 text-xs font-medium text-brand-700">
                    <Icone nom="mains" className="size-4" />
                    {b.nbContributions === 0
                      ? "Aucune aide proposée — soyez le premier"
                      : `${b.nbContributions} aide${b.nbContributions > 1 ? "s" : ""} proposée${b.nbContributions > 1 ? "s" : ""}`}
                  </p>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      <Panneau className="mt-10">
        <SectionTitre>Comment ça marche</SectionTitre>
        <ol className="grid gap-3 text-sm leading-relaxed text-slate-600 sm:grid-cols-3">
          <li><span className="font-medium text-ink-900">1. Un blocage.</span> Décrit en 200 caractères, publié sans votre nom.</li>
          <li><span className="font-medium text-ink-900">2. Des aides.</span> Indices, méthodes, exemples — une par personne, jamais la réponse.</li>
          <li><span className="font-medium text-ink-900">3. Des votes « Utile ».</span> Ils font remonter les meilleures aides et rapportent des points à leurs auteurs.</li>
        </ol>
      </Panneau>
    </div>
  );
}

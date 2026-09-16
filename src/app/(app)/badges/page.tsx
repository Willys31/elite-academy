import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/profile";
import {
  badgesClassiques,
  distinctions,
  FAMILLE_LABELS,
  FAMILLES,
  type Famille,
} from "@/lib/gamification/badges";
import { libelleNiveau } from "@/lib/gamification/niveaux";
import { resumeGamification } from "@/lib/gamification/resume";
import { CarteBadge } from "@/components/gamification/CarteBadge";
import { Chiffre, EcranTitre, Jauge, LienSobre, Panneau, Retour, SectionTitre } from "@/components/app";

export const metadata: Metadata = { title: "Badges" };

const STATUT_MENTION: Record<string, { libelle: string; classes: string }> = {
  pending: { libelle: "En attente de validation", classes: "bg-sand-100 text-slate-700 ring-sand-300" },
  validated: { libelle: "Validée", classes: "bg-brand-50 text-brand-700 ring-brand-200" },
  rejected: { libelle: "Refusée", classes: "bg-red-50 text-red-700 ring-red-200" },
};

/**
 * Badges de l'apprenant (addendum Gamification §8.2) : niveau global,
 * grille des badges classiques filtrable par famille, distinctions à
 * part. Les badges verrouillés restent visibles avec leur condition.
 */
export default async function BadgesPage({
  searchParams,
}: {
  searchParams: Promise<{ famille?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/connexion");

  const params = await searchParams;
  const familleFiltre = (FAMILLES as readonly string[]).includes(params.famille ?? "")
    ? (params.famille as Famille)
    : null;

  const supabase = await createClient();
  const [resume, { data: mentions }] = await Promise.all([
    resumeGamification(supabase, user.id),
    supabase
      .from("special_mentions")
      .select("id, status, comment, created_at, validated_at, badge:badges(badge_key, name, description)")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false }),
  ]);

  const premiereObtention = new Map<string, string>();
  const nbParCle = new Map<string, number>();
  for (const b of resume.obtenus) {
    nbParCle.set(b.key, (nbParCle.get(b.key) ?? 0) + 1);
    const existant = premiereObtention.get(b.key);
    if (!existant || b.earnedAt < existant) premiereObtention.set(b.key, b.earnedAt);
  }

  const classiques = badgesClassiques().filter(
    (b) => !familleFiltre || b.famille === familleFiltre
  );
  const nbObtenus = badgesClassiques().filter((b) => premiereObtention.has(b.key)).length;

  return (
    <div>
      <Retour href="/accueil" />
      <EcranTitre
        eyebrow="Gamification"
        intro="Les badges récompensent votre régularité et vos réussites. Ils ne changent rien à vos niveaux de compétence, seule référence pour la certification."
        action={<LienSobre href="/classement">Voir le classement</LienSobre>}
      >
        Mes badges
      </EcranTitre>

      {/* ---------- Niveau ---------- */}
      <Panneau>
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
          <div>
            <p className="text-sm font-medium text-slate-500">Niveau global</p>
            <p className="mt-0.5 text-2xl font-semibold tracking-[-0.02em] text-ink-950">
              Niveau {resume.niveau.niveau} · {resume.niveau.titre}
            </p>
          </div>
          <p className="text-sm tabular-nums text-slate-600">{libelleNiveau(resume.niveau)}</p>
        </div>
        <div className="mt-4">
          <Jauge
            pourcent={resume.niveau.progressionPourcent}
            libelle={
              resume.niveau.xpNiveauSuivant === null
                ? "Niveau maximal atteint"
                : `${resume.niveau.xpNiveauSuivant - resume.niveau.xpTotal} XP avant le niveau ${resume.niveau.niveau + 1}`
            }
          />
        </div>
      </Panneau>

      <dl className="mt-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Chiffre valeur={resume.xpTotal} libelle="XP" detail="cumulés" />
        <Chiffre valeur={nbObtenus} libelle="Badges" detail={`sur ${badgesClassiques().length}`} />
        <Chiffre valeur={resume.serieJours} libelle="Série" detail="jours d'affilée" />
        <Chiffre
          valeur={resume.obtenus.filter((b) => distinctions().some((d) => d.key === b.key)).length}
          libelle="Distinctions"
          detail="validées"
        />
      </dl>

      {/* ---------- Grille ---------- */}
      <section className="mt-10">
        <SectionTitre compte={classiques.length}>Badges</SectionTitre>
        <nav aria-label="Filtrer par famille" className="mb-4 flex flex-wrap gap-2">
          {[null, ...FAMILLES.filter((f) => f !== "distinction")].map((f) => {
            const actif = f === familleFiltre;
            return (
              <Link
                key={f ?? "toutes"}
                href={f ? `/badges?famille=${f}` : "/badges"}
                className={`rounded-md border px-3 py-1.5 text-sm font-medium transition-colors duration-150 ${
                  actif
                    ? "border-brand-700 bg-brand-700 text-white"
                    : "border-sand-300 bg-white text-slate-700 hover:bg-sand-50"
                }`}
              >
                {f ? FAMILLE_LABELS[f] : "Tous"}
              </Link>
            );
          })}
        </nav>
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {classiques.map((b) => (
            <CarteBadge
              key={b.key}
              badge={b}
              obtenuLe={premiereObtention.get(b.key) ?? null}
              actuel={b.compteur ? (resume.compteurs[b.compteur] ?? 0) : undefined}
              nbObtentions={nbParCle.get(b.key) ?? 0}
            />
          ))}
        </ul>
      </section>

      {/* ---------- Distinctions ---------- */}
      <section className="mt-10">
        <SectionTitre>Distinctions</SectionTitre>
        <p className="mb-4 max-w-2xl text-sm leading-relaxed text-slate-600">
          Rares et validées par un formateur : elles restent acquises même quand
          le classement change.
        </p>
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {distinctions().map((b) => (
            <CarteBadge key={b.key} badge={b} obtenuLe={premiereObtention.get(b.key) ?? null} />
          ))}
        </ul>

        {(mentions ?? []).length > 0 ? (
          <Panneau flush className="mt-6">
            <ul className="divide-y divide-sand-100">
              {(mentions ?? []).map((m) => {
                const badge = Array.isArray(m.badge) ? m.badge[0] : m.badge;
                const statut = STATUT_MENTION[m.status as string] ?? STATUT_MENTION.pending;
                return (
                  <li key={m.id} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 px-5 py-4">
                    <div className="min-w-0">
                      <p className="font-medium text-ink-900">{badge?.name}</p>
                      <p className="text-xs text-slate-500">
                        Proposée le{" "}
                        {new Date(m.created_at).toLocaleDateString("fr-FR", { day: "numeric", month: "long" })}
                      </p>
                      {m.comment ? (
                        <p className="mt-1 text-sm leading-relaxed text-slate-600">« {m.comment} »</p>
                      ) : null}
                    </div>
                    <span className={`rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${statut.classes}`}>
                      {statut.libelle}
                    </span>
                  </li>
                );
              })}
            </ul>
          </Panneau>
        ) : null}
      </section>
    </div>
  );
}

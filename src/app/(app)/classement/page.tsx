import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/profile";
import { STATUTS_AVEC_ACCES } from "@/lib/courses/inscriptions";
import { lirePreferences } from "@/lib/profil/preferences";
import {
  classerParticipants,
  FENETRE_LABELS,
  fenetreClassement,
  fenetreValide,
  medaille,
  type Fenetre,
  type LigneClassee,
  type LigneClassement,
} from "@/lib/gamification/classement";
import { Icone } from "@/components/icons";
import { Alert } from "@/components/ui";
import { EcranTitre, LienSobre, Panneau, Retour, SectionTitre, Vide } from "@/components/app";

export const metadata: Metadata = { title: "Classement" };

const COULEUR_MEDAILLE = {
  or: "bg-gold-300/40 text-gold-600 ring-gold-400/60",
  argent: "bg-sand-100 text-slate-700 ring-sand-300",
  bronze: "bg-[#f3e3d3] text-[#8a4b12] ring-[#e0c3a6]",
} as const;

/**
 * Classement par formation (addendum Gamification §7) : Top 10, position
 * personnelle, « les 5 autour de toi », fenêtre hebdomadaire ou
 * mensuelle. Jamais global à la plateforme ; les agrégats viennent de la
 * fonction SQL `classement_formation`, qui exclut les apprenants ayant
 * masqué leur classement.
 */
export default async function ClassementPage({
  searchParams,
}: {
  searchParams: Promise<{ formation?: string; fenetre?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/connexion");

  const params = await searchParams;
  const fenetre: Fenetre = fenetreValide(params.fenetre) ? params.fenetre : "semaine";

  const supabase = await createClient();
  const [{ data: inscriptions }, { data: profil }] = await Promise.all([
    supabase
      .from("enrollments")
      .select("course:courses(id, title)")
      .eq("user_id", user.id)
      .in("status", [...STATUTS_AVEC_ACCES])
      .order("created_at", { ascending: false }),
    supabase.from("profiles").select("preferences").eq("id", user.id).maybeSingle(),
  ]);

  const formations = (inscriptions ?? [])
    .map((i) => (Array.isArray(i.course) ? i.course[0] : i.course))
    .filter((c): c is { id: string; title: string } => Boolean(c));
  const preferences = lirePreferences(profil?.preferences);

  const formationChoisie =
    formations.find((f) => f.id === params.formation) ?? formations[0] ?? null;

  const bornes = fenetreClassement(fenetre);
  let lignes: LigneClassement[] = [];
  let erreur: string | null = null;
  if (formationChoisie) {
    const { data, error } = await supabase.rpc("classement_formation", {
      cid: formationChoisie.id,
      debut: bornes.debut,
      fin: bornes.fin,
    });
    if (error) {
      erreur =
        error.code === "42883" || error.code === "PGRST202"
          ? "Le classement n'est pas encore disponible : appliquez la migration 0013."
          : "Le classement n'a pas pu être chargé.";
    } else {
      lignes = (data ?? []).map((l: Record<string, unknown>) => ({
        user_id: String(l.user_id),
        nom_affiche: String(l.nom_affiche ?? "Apprenant"),
        xp_total: Number(l.xp_total ?? 0),
        nb_badges: Number(l.nb_badges ?? 0),
        score_moyen: l.score_moyen === null || l.score_moyen === undefined ? null : Number(l.score_moyen),
        inscrit_le: l.inscrit_le ? String(l.inscrit_le) : null,
      }));
    }
  }
  const classement = classerParticipants(lignes, user.id);

  return (
    <div>
      <Retour href="/accueil" />
      <EcranTitre
        eyebrow="Gamification"
        intro="Classement de votre formation sur la période, calculé à partir des points gagnés. Il se remet à zéro à chaque période : tout le monde repart avec ses chances."
        action={<LienSobre href="/badges">Mes badges</LienSobre>}
      >
        Classement
      </EcranTitre>

      {!preferences.classement.visible ? (
        <div className="mb-6">
          <Alert kind="info">
            Vous avez choisi de ne pas apparaître dans les classements. Vous pouvez
            consulter celui-ci, mais votre position n&apos;est pas calculée.{" "}
            <Link href="/profil" className="font-medium underline">
              Modifier dans mon profil
            </Link>
          </Alert>
        </div>
      ) : null}

      {formations.length === 0 ? (
        <Vide
          titre="Aucune formation suivie"
          texte="Le classement se fait formation par formation : inscrivez-vous à une formation pour y apparaître."
          action={<LienSobre href="/catalogue">Parcourir le catalogue</LienSobre>}
        />
      ) : (
        <>
          {/* ---------- Filtres ---------- */}
          <form method="get" className="mb-6 flex flex-wrap items-end gap-3">
            <label className="min-w-0 flex-1 text-sm font-medium text-ink-900">
              Formation
              <select
                name="formation"
                defaultValue={formationChoisie?.id}
                className="mt-1.5 block min-h-11 w-full rounded-lg border border-sand-300 bg-white px-3 text-base text-ink-900 sm:text-sm"
              >
                {formations.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.title}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex gap-1 rounded-lg border border-sand-300 bg-white p-1">
              {(Object.keys(FENETRE_LABELS) as Fenetre[]).map((f) => (
                <button
                  key={f}
                  type="submit"
                  name="fenetre"
                  value={f}
                  aria-pressed={f === fenetre}
                  className={`min-h-9 rounded-md px-3 text-sm font-medium transition-colors duration-150 ${
                    f === fenetre ? "bg-brand-700 text-white" : "text-slate-600 hover:bg-sand-100"
                  }`}
                >
                  {FENETRE_LABELS[f]}
                </button>
              ))}
            </div>
          </form>

          {erreur ? <Alert kind="error">{erreur}</Alert> : null}

          {!erreur && classement.nbParticipants === 0 ? (
            <Vide
              titre="Personne n'a encore marqué de points"
              texte={`${bornes.libelle} · Terminez une leçon ou réussissez un QCM pour ouvrir le classement.`}
            />
          ) : null}

          {!erreur && classement.nbParticipants > 0 ? (
            <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
              <section>
                <SectionTitre compte={classement.nbParticipants}>
                  Top 10 · {bornes.libelle}
                </SectionTitre>
                <Panneau flush>
                  <ol className="divide-y divide-sand-100">
                    {classement.top.map((l) => (
                      <LigneClassementItem key={l.user_id} ligne={l} />
                    ))}
                  </ol>
                </Panneau>
              </section>

              <section>
                <SectionTitre>Autour de vous</SectionTitre>
                {classement.maPosition ? (
                  <>
                    <Panneau ton="encre">
                      <p className="text-sm text-brand-200">Votre position</p>
                      <p className="mt-1 text-3xl font-semibold tracking-[-0.03em]">
                        {classement.maPosition.rang}
                        <span className="text-base font-normal text-white/60">
                          {" "}
                          / {classement.nbParticipants}
                        </span>
                      </p>
                      <p className="mt-1 text-sm text-white/70">
                        {classement.maPosition.xp_total} XP sur la période
                      </p>
                    </Panneau>
                    <Panneau flush className="mt-4">
                      <ol className="divide-y divide-sand-100">
                        {classement.autourDeMoi.map((l) => (
                          <LigneClassementItem key={l.user_id} ligne={l} compact />
                        ))}
                      </ol>
                    </Panneau>
                  </>
                ) : (
                  <Panneau>
                    <p className="text-sm leading-relaxed text-slate-600">
                      {preferences.classement.visible
                        ? "Vous n'avez pas encore de points sur cette période."
                        : "Votre position n'est pas calculée tant que votre classement est masqué."}
                    </p>
                  </Panneau>
                )}
              </section>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

function LigneClassementItem({ ligne, compact = false }: { ligne: LigneClassee; compact?: boolean }) {
  const m = medaille(ligne.rang);
  return (
    <li
      className={`flex items-center gap-3 px-4 py-3 ${ligne.moi ? "bg-brand-50/70" : ""}`}
      aria-current={ligne.moi ? "true" : undefined}
    >
      <span
        className={`flex size-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold tabular-nums ring-1 ring-inset ${
          m ? COULEUR_MEDAILLE[m] : "bg-white text-slate-600 ring-sand-200"
        }`}
      >
        {m ? <Icone nom="medaille" className="size-4" /> : ligne.rang}
      </span>
      <div className="min-w-0 flex-1">
        <p className={`truncate text-sm ${ligne.moi ? "font-semibold text-brand-900" : "font-medium text-ink-900"}`}>
          {ligne.nom_affiche}
          {ligne.moi ? <span className="ml-1.5 text-xs font-normal text-brand-700">(vous)</span> : null}
        </p>
        {!compact ? (
          <p className="text-xs text-slate-500">
            {ligne.nb_badges} badge{ligne.nb_badges > 1 ? "s" : ""}
            {ligne.score_moyen !== null ? ` · ${ligne.score_moyen} % de moyenne` : ""}
          </p>
        ) : null}
      </div>
      <span className="shrink-0 text-sm font-semibold tabular-nums text-ink-900">{ligne.xp_total} XP</span>
    </li>
  );
}

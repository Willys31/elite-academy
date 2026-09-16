import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/profile";
import { lirePreferences } from "@/lib/profil/preferences";
import { etiquettePortee } from "@/lib/partage/visibilite";
import {
  entraideActive,
  libelleAuteurAnonyme,
  LIMITE_CONTRIBUTION,
  MIN_CONTRIBUTION,
  REGLES_CONTRIBUTION,
  STATUT_BLOCAGE_LABELS,
  TON_STATUT_BLOCAGE,
} from "@/lib/entraide/entraide";
import { badgeParCle } from "@/lib/gamification/badges";
import {
  demasquerContribution,
  marquerResolu,
  masquerBlocage,
  masquerContribution,
  proposerAide,
  signalerContribution,
  voterUtile,
} from "@/app/(app)/entraide/actions";
import { AuthForm } from "@/components/ui/AuthForm";
import { Icone } from "@/components/icons";
import { Alert, Input, Textarea } from "@/components/ui";
import { Champ, EcranTitre, Etiquette, Panneau, Retour, SectionTitre } from "@/components/app";

export const metadata: Metadata = { title: "Point bloquant" };

/**
 * Détail d'un blocage (addendum Entraide §8.1-8.2) : description
 * anonymisée, aides des pairs avec votes « Utile », formulaire de
 * contribution, signalement, résolution par l'auteur, modération.
 */
export default async function BlocagePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) redirect("/connexion");

  const supabase = await createClient();
  const { data: post } = await supabase
    .from("peer_help_posts")
    .select(
      "id, user_id, course_id, visibility_scope, description, status, is_hidden, hidden_reason, created_at, resolved_at, course:courses(title), competency:competencies(name), activity:activities(id, title)"
    )
    .eq("id", id)
    .maybeSingle();
  if (!post) notFound();

  const [{ data: profil }, { data: encadrement }, { data: contributions }, { data: mesVotes }] =
    await Promise.all([
      supabase.from("profiles").select("preferences").eq("id", user.id).maybeSingle(),
      supabase.rpc("oversees_course", { cid: post.course_id }),
      supabase
        .from("peer_help_contributions")
        .select(
          "id, user_id, contribution_text, useful_votes_count, is_hidden, hidden_reason, created_at, auteur:profiles!peer_help_contributions_user_id_fkey(full_name)"
        )
        .eq("post_id", post.id)
        .order("useful_votes_count", { ascending: false })
        .order("created_at", { ascending: true }),
      supabase.from("peer_help_votes").select("contribution_id").eq("user_id", user.id),
    ]);

  const actif = entraideActive(lirePreferences(profil?.preferences));
  const encadrant = Boolean(encadrement);
  const auteur = post.user_id === user.id;
  const dejaVote = new Set((mesVotes ?? []).map((v) => v.contribution_id as string));

  const premier = <T,>(v: T | T[] | null | undefined): T | null =>
    Array.isArray(v) ? (v[0] ?? null) : (v ?? null);
  const course = premier(post.course);
  const competence = premier(post.competency);
  const activite = premier(post.activity);
  const portee = etiquettePortee(post.visibility_scope as "group");

  // Badges communauté des contributeurs (visibles entre membres d'une même org).
  const idsContributeurs = [...new Set((contributions ?? []).map((c) => c.user_id as string))];
  const { data: badgesContributeurs } =
    idsContributeurs.length > 0
      ? await supabase
          .from("learner_badges")
          .select("user_id, badge:badges(badge_key, family)")
          .in("user_id", idsContributeurs)
      : { data: [] };
  const badgesPar = new Map<string, string[]>();
  for (const b of badgesContributeurs ?? []) {
    const def = premier(b.badge);
    if (def?.family !== "communaute" && def?.family !== "distinction") continue;
    const nom = badgeParCle(def.badge_key as string)?.nom;
    if (!nom) continue;
    badgesPar.set(b.user_id as string, [...(badgesPar.get(b.user_id as string) ?? []), nom]);
  }

  const dejaContribue = (contributions ?? []).some((c) => c.user_id === user.id);
  const ouvert = post.status === "open";

  return (
    <div className="mx-auto max-w-3xl">
      <Retour href="/entraide" />
      <EcranTitre
        eyebrow={`${libelleAuteurAnonyme(course?.title)}${competence?.name ? ` · ${competence.name}` : ""}`}
        action={
          <>
            <Etiquette ton={TON_STATUT_BLOCAGE[post.status as string] ?? "neutre"}>
              {STATUT_BLOCAGE_LABELS[post.status as string] ?? post.status}
            </Etiquette>
            <Etiquette ton={portee.ton}>{portee.libelle}</Etiquette>
          </>
        }
      >
        Point bloquant
      </EcranTitre>

      {post.is_hidden ? (
        <div className="mb-4">
          <Alert kind="error">
            Ce blocage est masqué par l&apos;encadrement{post.hidden_reason ? ` : ${post.hidden_reason}` : "."}
          </Alert>
        </div>
      ) : null}

      <Panneau>
        <p className="text-lg leading-relaxed text-ink-900">{post.description}</p>
        <p className="mt-3 text-xs text-slate-500">
          Publié le {new Date(post.created_at).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })}
          {activite?.title ? ` · activité « ${activite.title} »` : ""}
          {post.resolved_at ? ` · résolu le ${new Date(post.resolved_at).toLocaleDateString("fr-FR", { day: "numeric", month: "long" })}` : ""}
        </p>

        {(auteur && ouvert) || (encadrant && !post.is_hidden) ? (
          <div className="mt-4 flex flex-wrap gap-4 border-t border-sand-200 pt-4">
            {auteur && ouvert ? (
              <AuthForm action={marquerResolu} submitLabel="Marquer comme résolu" pendingLabel="…" ton="sobre">
                <input type="hidden" name="post_id" value={post.id} />
              </AuthForm>
            ) : null}
            {encadrant && !post.is_hidden ? (
              <details className="text-sm">
                <summary className="cursor-pointer font-medium text-slate-600 hover:text-ink-900">Masquer ce blocage</summary>
                <div className="mt-2 max-w-sm">
                  <AuthForm action={masquerBlocage} submitLabel="Masquer" pendingLabel="…" ton="sobre">
                    <input type="hidden" name="id" value={post.id} />
                    <Input name="reason" required minLength={3} placeholder="Motif transmis à l'auteur" />
                  </AuthForm>
                </div>
              </details>
            ) : null}
          </div>
        ) : null}
      </Panneau>

      {/* ---------- Aides ---------- */}
      <section className="mt-8">
        <SectionTitre compte={(contributions ?? []).length}>Aides proposées</SectionTitre>
        {(contributions ?? []).length === 0 ? (
          <p className="text-sm text-slate-500">Personne n&apos;a encore proposé d&apos;aide.</p>
        ) : (
          <ul className="space-y-3">
            {(contributions ?? []).map((c) => {
              const auteurContribution = premier(c.auteur);
              const mienne = c.user_id === user.id;
              const prenom = (auteurContribution?.full_name as string | undefined)?.split(" ")[0] || "Un pair";
              const badges = badgesPar.get(c.user_id as string) ?? [];
              return (
                <li key={c.id}>
                  <Panneau className={c.is_hidden ? "border-dashed opacity-70" : ""}>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="flex size-8 items-center justify-center rounded-full bg-brand-100 text-xs font-semibold text-brand-800">
                        {prenom.charAt(0).toUpperCase()}
                      </span>
                      <span className="text-sm font-medium text-ink-900">{mienne ? "Vous" : prenom}</span>
                      {badges.slice(0, 2).map((b) => (
                        <Etiquette key={b} ton="or">{b}</Etiquette>
                      ))}
                      {c.is_hidden ? <Etiquette ton="alerte">Masquée</Etiquette> : null}
                      <span className="ml-auto text-xs text-slate-500">
                        {new Date(c.created_at).toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}
                      </span>
                    </div>
                    <p className="mt-3 whitespace-pre-line text-[15px] leading-relaxed text-ink-900">{c.contribution_text}</p>
                    {c.is_hidden && c.hidden_reason ? (
                      <p className="mt-2 text-xs text-red-700">Motif : {c.hidden_reason}</p>
                    ) : null}

                    <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-sand-200 pt-3 text-sm">
                      <span className="inline-flex items-center gap-1.5 font-medium text-slate-700">
                        <Icone nom="pouce" className="size-4" />
                        {c.useful_votes_count} Utile
                      </span>
                      {!mienne && !c.is_hidden ? (
                        dejaVote.has(c.id as string) ? (
                          <span className="text-xs text-slate-500">Vous avez voté</span>
                        ) : (
                          <AuthForm action={voterUtile} submitLabel="Utile" pendingLabel="…" ton="sobre">
                            <input type="hidden" name="contribution_id" value={c.id} />
                          </AuthForm>
                        )
                      ) : null}
                      {!mienne && !c.is_hidden ? (
                        <details className="text-xs">
                          <summary className="cursor-pointer text-slate-500 hover:text-ink-900">Signaler</summary>
                          <div className="mt-2 max-w-sm">
                            <AuthForm action={signalerContribution} submitLabel="Envoyer le signalement" pendingLabel="…" ton="sobre">
                              <input type="hidden" name="contribution_id" value={c.id} />
                              <Input name="reason" required minLength={3} placeholder="Spam, hors sujet, réponse directe…" />
                            </AuthForm>
                          </div>
                        </details>
                      ) : null}
                      {encadrant ? (
                        c.is_hidden ? (
                          <AuthForm action={demasquerContribution} submitLabel="Rendre visible" pendingLabel="…" ton="sobre">
                            <input type="hidden" name="id" value={c.id} />
                          </AuthForm>
                        ) : (
                          <details className="text-xs">
                            <summary className="cursor-pointer text-slate-500 hover:text-ink-900">Masquer</summary>
                            <div className="mt-2 max-w-sm">
                              <AuthForm action={masquerContribution} submitLabel="Masquer" pendingLabel="…" ton="sobre">
                                <input type="hidden" name="id" value={c.id} />
                                <Input name="reason" required minLength={3} placeholder="Motif transmis à l'auteur" />
                              </AuthForm>
                            </div>
                          </details>
                        )
                      ) : null}
                    </div>
                  </Panneau>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* ---------- Proposer une aide ---------- */}
      {!auteur && ouvert && !post.is_hidden ? (
        <section className="mt-8">
          <SectionTitre>Proposer une aide</SectionTitre>
          {!actif ? (
            <Alert kind="info">Activez l&apos;Entraide dans votre profil pour proposer une aide.</Alert>
          ) : dejaContribue ? (
            <Alert kind="info">Vous avez déjà proposé une aide sur ce blocage — une seule par personne, pour laisser la place aux autres.</Alert>
          ) : (
            <Panneau>
              <ul className="mb-4 space-y-1 text-xs leading-relaxed text-slate-500">
                {REGLES_CONTRIBUTION.map((r) => (
                  <li key={r}>• {r}</li>
                ))}
              </ul>
              <AuthForm action={proposerAide} submitLabel="Publier mon aide" pendingLabel="Publication…">
                <input type="hidden" name="post_id" value={post.id} />
                <div>
                  <Champ htmlFor="contribution" hint={`${MIN_CONTRIBUTION} à ${LIMITE_CONTRIBUTION} caractères`}>
                    Mon aide
                  </Champ>
                  <Textarea id="contribution" name="contribution" required minLength={MIN_CONTRIBUTION} maxLength={LIMITE_CONTRIBUTION} rows={5} placeholder="Un indice, une méthode, un exemple…" />
                </div>
              </AuthForm>
            </Panneau>
          )}
        </section>
      ) : null}
    </div>
  );
}

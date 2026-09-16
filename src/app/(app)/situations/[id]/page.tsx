import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/profile";
import { STATUTS_AVEC_ACCES } from "@/lib/courses/inscriptions";
import { etiquettePortee } from "@/lib/partage/visibilite";
import {
  libelleAuteur,
  SECTEUR_LABELS,
  secteurValide,
  STATUT_SITUATION_LABELS,
  TON_STATUT_SITUATION,
} from "@/lib/situations/situations";
import {
  lierABlocage,
  mettreEnAvant,
  modifierSituation,
  refuserSituation,
  supprimerSituation,
  validerSituation,
  voterSituationUtile,
} from "@/app/(app)/situations/actions";
import { FormulaireSituation } from "@/app/(app)/situations/FormulaireSituation";
import { AuthForm } from "@/components/ui/AuthForm";
import { DangerForm } from "@/components/ui/DangerForm";
import { Icone } from "@/components/icons";
import { Alert, CLASSES_CHAMP, Textarea } from "@/components/ui";
import { EcranTitre, Etiquette, Panneau, Retour, SectionTitre } from "@/components/app";

export const metadata: Metadata = { title: "Situation de travail" };

/**
 * Détail d'une situation (addendum §10.1 et §10.3) : CSRR complet,
 * compétences, votes, lien avec un de mes blocages, correction par
 * l'auteur tant qu'elle attend, panneau de validation pour l'encadrement.
 */
export default async function SituationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) redirect("/connexion");

  const supabase = await createClient();
  const { data: s } = await supabase
    .from("work_situations")
    .select(
      "id, user_id, course_id, organization_id, visibility_scope, sector, title, context, situation, resolution, result, is_anonymized, status, is_complex_problem, useful_votes_count, rejection_reason, validated_at, featured_at, created_at, course:courses(id, title, sector, organization:organizations(sector)), auteur:profiles!work_situations_user_id_fkey(full_name), competences:situation_competencies(competency:competencies(id, name)), tags:situation_tags(tag)"
    )
    .eq("id", id)
    .maybeSingle();
  if (!s) notFound();

  const premier = <T,>(v: T | T[] | null | undefined): T | null =>
    Array.isArray(v) ? (v[0] ?? null) : (v ?? null);

  const [{ data: encadrement }, { data: monVote }, { data: mesBlocages }, { data: liens }] = await Promise.all([
    supabase.rpc("oversees_course", { cid: s.course_id }),
    supabase.from("situation_votes").select("id").eq("situation_id", s.id).eq("user_id", user.id).maybeSingle(),
    supabase.from("peer_help_posts").select("id, description").eq("user_id", user.id).eq("status", "open"),
    supabase.from("situation_blocking_links").select("post_id, post:peer_help_posts(description)").eq("situation_id", s.id),
  ]);

  const encadrant = Boolean(encadrement);
  const auteur = s.user_id === user.id;
  const course = premier(s.course);
  const competences = ((s.competences ?? []) as Array<{ competency: unknown }>)
    .map((c) => premier(c.competency) as { id: string; name: string } | null)
    .filter((k): k is { id: string; name: string } => Boolean(k));
  const tags = ((s.tags ?? []) as Array<{ tag: string }>).map((t) => t.tag);
  const portee = etiquettePortee(s.visibility_scope as "group");
  const nomAuteur = libelleAuteur({
    isAnonymized: Boolean(s.is_anonymized) && !encadrant && !auteur,
    fullName: premier(s.auteur)?.full_name as string | undefined,
    secteur: s.sector as string,
  });

  // Formulaire de correction (auteur, en attente) : formations suivies.
  const { data: inscriptions } =
    auteur && s.status === "submitted"
      ? await supabase
          .from("enrollments")
          .select("course:courses(id, title, sector, organization:organizations(sector), course_competencies(competency:competencies(id, name)))")
          .eq("user_id", user.id)
          .in("status", [...STATUTS_AVEC_ACCES])
      : { data: [] };
  const formations = (inscriptions ?? [])
    .map((i) => premier(i.course))
    .filter((c): c is NonNullable<typeof c> => Boolean(c))
    .map((c) => ({
      id: c.id as string,
      title: c.title as string,
      sector: (c.sector as string) ?? null,
      sectorOrganisation: (premier(c.organization)?.sector as string) ?? null,
      competences: ((c.course_competencies ?? []) as Array<{ competency: unknown }>)
        .map((cc) => premier(cc.competency) as { id: string; name: string } | null)
        .filter((k): k is { id: string; name: string } => Boolean(k)),
    }));

  const sections: Array<[string, string]> = [
    ["Contexte", s.context as string],
    ["Situation", s.situation as string],
    ["Résolution", s.resolution as string],
    ["Résultat", s.result as string],
  ];

  return (
    <div className="mx-auto max-w-3xl">
      <Retour href="/situations" />
      <EcranTitre
        eyebrow={`${nomAuteur}${course?.title ? ` · ${course.title}` : ""}`}
        action={
          <>
            <Etiquette ton={TON_STATUT_SITUATION[s.status as string] ?? "neutre"}>{STATUT_SITUATION_LABELS[s.status as string]}</Etiquette>
            <Etiquette ton={portee.ton}>{portee.libelle}</Etiquette>
            <Etiquette>{secteurValide(s.sector) ? SECTEUR_LABELS[s.sector] : s.sector}</Etiquette>
          </>
        }
      >
        {s.title}
      </EcranTitre>

      {s.status === "rejected" && s.rejection_reason ? (
        <div className="mb-6"><Alert kind="error">Refusée par l&apos;encadrement : {s.rejection_reason}</Alert></div>
      ) : null}
      {s.status === "submitted" && auteur ? (
        <div className="mb-6"><Alert kind="info">En attente de validation par un formateur. Vous pouvez encore la corriger ci-dessous.</Alert></div>
      ) : null}

      {/* ---------- CSRR ---------- */}
      <Panneau>
        <dl className="space-y-6">
          {sections.map(([titre, texte]) => (
            <div key={titre}>
              <dt className="text-sm font-medium text-brand-700">{titre}</dt>
              <dd className="mt-1.5 whitespace-pre-line text-[15px] leading-relaxed text-ink-900">{texte}</dd>
            </div>
          ))}
        </dl>
        <div className="mt-6 flex flex-wrap gap-2 border-t border-sand-200 pt-4">
          {competences.map((k) => <Etiquette key={k.id} ton="succes">{k.name}</Etiquette>)}
          {tags.map((t) => <Etiquette key={t}>#{t}</Etiquette>)}
          {s.is_complex_problem ? <Etiquette ton="or">Problème complexe</Etiquette> : null}
        </div>
        <p className="mt-4 text-xs text-slate-500">
          Partagée le {new Date(s.created_at).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })}
          {s.validated_at ? ` · publiée le ${new Date(s.validated_at).toLocaleDateString("fr-FR", { day: "numeric", month: "long" })}` : ""}
        </p>

        {s.status === "validated" ? (
          <div className="mt-4 flex flex-wrap items-center gap-4 border-t border-sand-200 pt-4 text-sm">
            <span className="inline-flex items-center gap-1.5 font-medium text-slate-700">
              <Icone nom="pouce" className="size-4" />
              {s.useful_votes_count} Utile
            </span>
            {!auteur ? (
              monVote ? (
                <span className="text-xs text-slate-500">Vous avez voté</span>
              ) : (
                <AuthForm action={voterSituationUtile} submitLabel="Utile" pendingLabel="…" ton="sobre">
                  <input type="hidden" name="situation_id" value={s.id} />
                </AuthForm>
              )
            ) : null}
            {encadrant ? (
              <AuthForm action={mettreEnAvant} submitLabel={s.featured_at ? "Retirer de la une" : "Mettre à la une"} pendingLabel="…" ton="sobre">
                <input type="hidden" name="situation_id" value={s.id} />
                {s.featured_at ? <input type="hidden" name="retirer" value="1" /> : null}
              </AuthForm>
            ) : null}
          </div>
        ) : null}
      </Panneau>

      {/* ---------- Liens avec des blocages ---------- */}
      {s.status === "validated" ? (
        <section className="mt-8">
          <SectionTitre>Illustre un blocage</SectionTitre>
          {(liens ?? []).length > 0 ? (
            <ul className="mb-3 space-y-2 text-sm">
              {(liens ?? []).map((l) => (
                <li key={l.post_id as string}>
                  <Link href={`/entraide/${l.post_id}`} className="text-brand-700 hover:underline">
                    {premier(l.post)?.description as string}
                  </Link>
                </li>
              ))}
            </ul>
          ) : null}
          {(mesBlocages ?? []).length > 0 ? (
            <Panneau>
              <p className="mb-3 text-sm text-slate-600">Cette situation vous aide sur un de vos blocages ? Reliez-les : les pairs qui liront votre blocage la verront.</p>
              <AuthForm action={lierABlocage} submitLabel="Relier" pendingLabel="…" ton="sobre">
                <input type="hidden" name="situation_id" value={s.id} />
                <select name="post_id" className={CLASSES_CHAMP} required defaultValue="">
                  <option value="" disabled>Choisir un de mes blocages…</option>
                  {(mesBlocages ?? []).map((b) => (
                    <option key={b.id} value={b.id}>{(b.description as string).slice(0, 80)}</option>
                  ))}
                </select>
              </AuthForm>
            </Panneau>
          ) : null}
        </section>
      ) : null}

      {/* ---------- Validation (encadrement) ---------- */}
      {encadrant && !auteur && s.status === "submitted" ? (
        <section className="mt-8">
          <SectionTitre>Validation</SectionTitre>
          <p className="mb-3 text-sm leading-relaxed text-slate-600">
            Vérifiez la qualité pédagogique, l&apos;absence de données sensibles, la pertinence des compétences et l&apos;adéquation du niveau de partage ({portee.libelle}).
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Panneau>
              <AuthForm action={validerSituation} submitLabel="Valider et publier" pendingLabel="…">
                <input type="hidden" name="situation_id" value={s.id} />
                <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm text-ink-900">
                  <input type="checkbox" name="is_complex_problem" className="size-4 accent-brand-700" />
                  Résolution d&apos;un problème complexe (badge Problem Solver)
                </label>
              </AuthForm>
            </Panneau>
            <Panneau>
              <AuthForm action={refuserSituation} submitLabel="Refuser" pendingLabel="…" ton="sobre">
                <input type="hidden" name="situation_id" value={s.id} />
                <Textarea name="rejection_reason" rows={3} required minLength={5} placeholder="Motif transmis à l'apprenant" />
              </AuthForm>
            </Panneau>
          </div>
        </section>
      ) : null}

      {/* ---------- Correction / retrait (auteur) ---------- */}
      {auteur && s.status === "submitted" && formations.length > 0 ? (
        <section className="mt-8">
          <SectionTitre>Corriger ma situation</SectionTitre>
          <Panneau>
            <FormulaireSituation
              action={modifierSituation}
              formations={formations}
              formationInitiale={s.course_id as string}
              submitLabel="Enregistrer les corrections"
              situationId={s.id as string}
              valeurs={{
                course_id: s.course_id as string,
                sector: s.sector as string,
                visibility_scope: s.visibility_scope as string,
                is_anonymized: Boolean(s.is_anonymized),
                title: s.title as string,
                context: s.context as string,
                situation: s.situation as string,
                resolution: s.resolution as string,
                result: s.result as string,
                competences: competences.map((k) => k.id),
                tags,
              }}
            />
          </Panneau>
        </section>
      ) : null}
      {auteur && s.status !== "validated" ? (
        <div className="mt-6">
          <DangerForm action={supprimerSituation} label="Retirer ma situation" confirmLabel="Oui, retirer" pendingLabel="Retrait…" question="Retirer définitivement cette situation ?">
            <input type="hidden" name="situation_id" value={s.id} />
          </DangerForm>
        </div>
      ) : null}
    </div>
  );
}

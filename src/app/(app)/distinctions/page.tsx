import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/profile";
import { activeMemberships, isEliteAdmin } from "@/lib/auth/roles";
import { distinctions } from "@/lib/gamification/badges";
import {
  proposerDistinctionManuelle,
  refuserDistinction,
  validerDistinction,
} from "@/app/(app)/distinctions/actions";
import { AuthForm } from "@/components/ui/AuthForm";
import { CLASSES_CHAMP, Textarea } from "@/components/ui";
import { Champ, EcranTitre, Etiquette, Panneau, Retour, SectionTitre, Vide } from "@/components/app";

export const metadata: Metadata = { title: "Distinctions" };

/**
 * File des distinctions à valider (addendum Gamification §5.4) et
 * proposition manuelle. Écran de l'encadrement : formateurs,
 * responsables, concepteurs, administrateurs. La lecture est filtrée par
 * RLS (`special_mentions_select`).
 */
export default async function DistinctionsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/connexion");

  const elite = isEliteAdmin(user.memberships);
  const encadrees = activeMemberships(user.memberships).filter((m) =>
    ["admin", "designer", "trainer", "manager"].includes(m.role)
  );
  if (!elite && encadrees.length === 0) redirect("/sans-acces");

  const supabase = await createClient();
  const [{ data: mentions }, { data: organisations }] = await Promise.all([
    supabase
      .from("special_mentions")
      .select(
        "id, status, criteria, comment, created_at, validated_at, course_id, organization_id, apprenant:profiles!special_mentions_user_id_fkey(full_name), badge:badges(badge_key, name, description), course:courses(title), organization:organizations(name)"
      )
      .order("created_at", { ascending: false })
      .limit(100),
    elite
      ? supabase.from("organizations").select("id, name").order("name")
      : Promise.resolve({
          data: encadrees.map((m) => ({ id: m.organization_id, name: m.organization?.name ?? "Organisation" })),
        }),
  ]);

  const enAttente = (mentions ?? []).filter((m) => m.status === "pending");
  const traitees = (mentions ?? []).filter((m) => m.status !== "pending").slice(0, 20);

  // Apprenants des organisations encadrées, pour la proposition manuelle.
  const idsOrgs = (organisations ?? []).map((o) => o.id as string);
  const { data: membres } =
    idsOrgs.length > 0
      ? await supabase
          .from("organization_members")
          .select("organization_id, user_id, role, profile:profiles(full_name)")
          .in("organization_id", idsOrgs)
          .eq("status", "active")
          .eq("role", "learner")
      : { data: [] };

  const premier = <T,>(v: T | T[] | null | undefined): T | null =>
    Array.isArray(v) ? (v[0] ?? null) : (v ?? null);

  return (
    <div>
      <Retour href="/accueil" />
      <EcranTitre
        eyebrow="Encadrement"
        intro="Les distinctions sont rares et honorifiques. Elles sont proposées automatiquement quand les conditions sont réunies, ou par un encadrant ; rien n'est attribué sans votre validation."
      >
        Distinctions
      </EcranTitre>

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <section>
          <SectionTitre compte={enAttente.length}>À valider</SectionTitre>
          {enAttente.length === 0 ? (
            <Vide
              titre="Aucune distinction en attente"
              texte="Les propositions apparaîtront ici dès qu'un apprenant remplira les conditions d'une distinction."
            />
          ) : (
            <ul className="space-y-4">
              {enAttente.map((m) => {
                const badge = premier(m.badge);
                const apprenant = premier(m.apprenant);
                const course = premier(m.course);
                const organisation = premier(m.organization);
                const criteres = (m.criteria ?? {}) as Record<string, unknown>;
                return (
                  <li key={m.id}>
                    <Panneau>
                      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-brand-700">{badge?.name}</p>
                          <p className="mt-0.5 text-lg font-semibold text-ink-900">
                            {apprenant?.full_name || "Apprenant"}
                          </p>
                          <p className="text-xs text-slate-500">
                            {[organisation?.name, course?.title].filter(Boolean).join(" · ")} · proposée le{" "}
                            {new Date(m.created_at).toLocaleDateString("fr-FR", { day: "numeric", month: "long" })}
                          </p>
                        </div>
                        <Etiquette>En attente</Etiquette>
                      </div>
                      <p className="mt-3 text-sm leading-relaxed text-slate-600">{badge?.description}</p>
                      {typeof criteres.justification === "string" ? (
                        <p className="mt-2 border-l-2 border-brand-300 pl-3 text-sm text-slate-600">
                          {criteres.justification}
                        </p>
                      ) : typeof criteres.badge_declencheur === "string" ? (
                        <p className="mt-2 text-xs text-slate-500">
                          Déclenchée automatiquement par le badge « {criteres.badge_declencheur} ».
                        </p>
                      ) : null}

                      <div className="mt-4 grid gap-3 sm:grid-cols-2">
                        <AuthForm action={validerDistinction} submitLabel="Valider" pendingLabel="Validation…">
                          <input type="hidden" name="mention_id" value={m.id} />
                          <Textarea name="comment" rows={2} placeholder="Commentaire (facultatif)" />
                        </AuthForm>
                        <AuthForm action={refuserDistinction} submitLabel="Refuser" pendingLabel="Refus…" ton="sobre">
                          <input type="hidden" name="mention_id" value={m.id} />
                          <Textarea name="comment" rows={2} required placeholder="Motif du refus (transmis à l'apprenant)" />
                        </AuthForm>
                      </div>
                    </Panneau>
                  </li>
                );
              })}
            </ul>
          )}

          {traitees.length > 0 ? (
            <div className="mt-8">
              <SectionTitre compte={traitees.length}>Décisions récentes</SectionTitre>
              <Panneau flush>
                <ul className="divide-y divide-sand-100">
                  {traitees.map((m) => {
                    const badge = premier(m.badge);
                    const apprenant = premier(m.apprenant);
                    return (
                      <li key={m.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-5 py-3">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-ink-900">
                            {apprenant?.full_name || "Apprenant"} · {badge?.name}
                          </p>
                          {m.comment ? <p className="text-xs text-slate-500">« {m.comment} »</p> : null}
                        </div>
                        <Etiquette ton={m.status === "validated" ? "succes" : "alerte"}>
                          {m.status === "validated" ? "Validée" : "Refusée"}
                        </Etiquette>
                      </li>
                    );
                  })}
                </ul>
              </Panneau>
            </div>
          ) : null}
        </section>

        <section>
          <SectionTitre>Proposer une distinction</SectionTitre>
          <Panneau>
            <AuthForm action={proposerDistinctionManuelle} submitLabel="Proposer" pendingLabel="Envoi…">
              <div>
                <Champ htmlFor="user_id">Apprenant</Champ>
                <select id="user_id" name="user_id" required className={CLASSES_CHAMP} defaultValue="">
                  <option value="" disabled>
                    Choisir…
                  </option>
                  {(membres ?? []).map((mb) => {
                    const p = premier(mb.profile);
                    return (
                      <option key={`${mb.organization_id}-${mb.user_id}`} value={mb.user_id}>
                        {p?.full_name || mb.user_id}
                      </option>
                    );
                  })}
                </select>
              </div>
              <div>
                <Champ htmlFor="organization_id">Organisation</Champ>
                <select id="organization_id" name="organization_id" required className={CLASSES_CHAMP}>
                  {(organisations ?? []).map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <Champ htmlFor="badge_key">Distinction</Champ>
                <select id="badge_key" name="badge_key" required className={CLASSES_CHAMP}>
                  {distinctions().map((d) => (
                    <option key={d.key} value={d.key}>
                      {d.nom}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <Champ htmlFor="justification" hint="10 caractères minimum">
                  Justification
                </Champ>
                <Textarea id="justification" name="justification" rows={3} required minLength={10} />
              </div>
            </AuthForm>
          </Panneau>
        </section>
      </div>
    </div>
  );
}

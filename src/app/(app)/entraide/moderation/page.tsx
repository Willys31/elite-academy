import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/profile";
import { activeMemberships, isEliteAdmin } from "@/lib/auth/roles";
import {
  demasquerBlocage,
  demasquerContribution,
  masquerContribution,
  traiterSignalement,
} from "@/app/(app)/entraide/actions";
import { AuthForm } from "@/components/ui/AuthForm";
import { Input } from "@/components/ui";
import { EcranTitre, Etiquette, Panneau, Retour, SectionTitre, Vide } from "@/components/app";

export const metadata: Metadata = { title: "Modération de l'Entraide" };

/**
 * Modération (addendum Entraide §5.2) : signalements en attente et
 * contenus masqués des formations que j'encadre. La RLS limite déjà ce
 * que je vois ; l'écran ne fait qu'organiser.
 */
export default async function ModerationPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/connexion");
  const encadrant =
    isEliteAdmin(user.memberships) ||
    activeMemberships(user.memberships).some((m) => m.role !== "learner");
  if (!encadrant) redirect("/sans-acces");

  const supabase = await createClient();
  const [{ data: signalements }, { data: contributionsMasquees }, { data: blocagesMasques }] =
    await Promise.all([
      supabase
        .from("peer_help_reports")
        .select(
          "id, reason, created_at, contribution:peer_help_contributions(id, contribution_text, is_hidden, post_id)"
        )
        .eq("status", "pending")
        .order("created_at", { ascending: false }),
      supabase
        .from("peer_help_contributions")
        .select("id, contribution_text, hidden_reason, post_id")
        .eq("is_hidden", true)
        .order("created_at", { ascending: false })
        .limit(50),
      supabase
        .from("peer_help_posts")
        .select("id, description, hidden_reason")
        .eq("is_hidden", true)
        .order("created_at", { ascending: false })
        .limit(50),
    ]);

  const premier = <T,>(v: T | T[] | null | undefined): T | null =>
    Array.isArray(v) ? (v[0] ?? null) : (v ?? null);

  return (
    <div>
      <Retour href="/entraide" />
      <EcranTitre
        eyebrow="Encadrement"
        intro="Masquer retire un contenu de la vue des apprenants sans le supprimer ; l'auteur reçoit le motif. Un signalement traité reste tracé."
      >
        Modération de l&apos;Entraide
      </EcranTitre>

      <section>
        <SectionTitre compte={(signalements ?? []).length}>Signalements en attente</SectionTitre>
        {(signalements ?? []).length === 0 ? (
          <Vide titre="Aucun signalement" texte="Les contributions signalées par les apprenants apparaîtront ici." />
        ) : (
          <ul className="space-y-3">
            {(signalements ?? []).map((s) => {
              const c = premier(s.contribution);
              return (
                <li key={s.id}>
                  <Panneau>
                    <p className="text-xs font-medium text-red-700">Motif : {s.reason}</p>
                    {c ? (
                      <>
                        <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-ink-900">{c.contribution_text}</p>
                        <p className="mt-1 text-xs">
                          <Link href={`/entraide/${c.post_id}`} className="text-brand-700 hover:underline">
                            Voir le blocage
                          </Link>
                          {c.is_hidden ? <Etiquette ton="alerte">Déjà masquée</Etiquette> : null}
                        </p>
                      </>
                    ) : null}
                    <div className="mt-4 flex flex-wrap items-start gap-3 border-t border-sand-200 pt-3">
                      {c && !c.is_hidden ? (
                        <div className="max-w-sm">
                          <AuthForm action={masquerContribution} submitLabel="Masquer la contribution" pendingLabel="…">
                            <input type="hidden" name="id" value={c.id} />
                            <Input name="reason" required minLength={3} defaultValue={s.reason} placeholder="Motif transmis à l'auteur" />
                          </AuthForm>
                        </div>
                      ) : null}
                      <AuthForm action={traiterSignalement} submitLabel="Marquer traité" pendingLabel="…" ton="sobre">
                        <input type="hidden" name="report_id" value={s.id} />
                        <input type="hidden" name="decision" value="reviewed" />
                      </AuthForm>
                      <AuthForm action={traiterSignalement} submitLabel="Sans suite" pendingLabel="…" ton="sobre">
                        <input type="hidden" name="report_id" value={s.id} />
                        <input type="hidden" name="decision" value="dismissed" />
                      </AuthForm>
                    </div>
                  </Panneau>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <div className="mt-10 grid gap-6 lg:grid-cols-2">
        <section>
          <SectionTitre compte={(contributionsMasquees ?? []).length}>Contributions masquées</SectionTitre>
          {(contributionsMasquees ?? []).length === 0 ? (
            <p className="text-sm text-slate-500">Aucune.</p>
          ) : (
            <Panneau flush>
              <ul className="divide-y divide-sand-100">
                {(contributionsMasquees ?? []).map((c) => (
                  <li key={c.id} className="px-5 py-4">
                    <p className="text-sm leading-relaxed text-ink-900">{c.contribution_text}</p>
                    <p className="mt-1 text-xs text-slate-500">Motif : {c.hidden_reason}</p>
                    <div className="mt-2 flex items-center gap-3">
                      <Link href={`/entraide/${c.post_id}`} className="text-xs text-brand-700 hover:underline">Voir le blocage</Link>
                      <AuthForm action={demasquerContribution} submitLabel="Rendre visible" pendingLabel="…" ton="sobre">
                        <input type="hidden" name="id" value={c.id} />
                      </AuthForm>
                    </div>
                  </li>
                ))}
              </ul>
            </Panneau>
          )}
        </section>

        <section>
          <SectionTitre compte={(blocagesMasques ?? []).length}>Blocages masqués</SectionTitre>
          {(blocagesMasques ?? []).length === 0 ? (
            <p className="text-sm text-slate-500">Aucun.</p>
          ) : (
            <Panneau flush>
              <ul className="divide-y divide-sand-100">
                {(blocagesMasques ?? []).map((b) => (
                  <li key={b.id} className="px-5 py-4">
                    <p className="text-sm leading-relaxed text-ink-900">{b.description}</p>
                    <p className="mt-1 text-xs text-slate-500">Motif : {b.hidden_reason}</p>
                    <div className="mt-2 flex items-center gap-3">
                      <Link href={`/entraide/${b.id}`} className="text-xs text-brand-700 hover:underline">Voir</Link>
                      <AuthForm action={demasquerBlocage} submitLabel="Rendre visible" pendingLabel="…" ton="sobre">
                        <input type="hidden" name="id" value={b.id} />
                      </AuthForm>
                    </div>
                  </li>
                ))}
              </ul>
            </Panneau>
          )}
        </section>
      </div>
    </div>
  );
}

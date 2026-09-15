import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/profile";
import { isEliteAdmin } from "@/lib/auth/roles";
import { canDesignForOrganization, organizationsForDesign } from "@/lib/courses/statuts";
import { Badge, Card, EmptyState, LienTexte, PageTitle, Retour, SURVOL_CARTE } from "@/components/ui";
import { DangerForm } from "@/components/ui/DangerForm";
import { supprimerGeneration } from "@/app/(app)/validation/actions";

export const metadata: Metadata = { title: "Validation" };

const STATUT_GENERATION: Record<string, string> = {
  pending: "En attente",
  running: "En cours",
  succeeded: "Terminée",
  failed: "Échouée",
};

/* Une génération échouée est une anomalie : elle doit se repérer sans
   lire l'étiquette. Le reste est neutre — une génération en cours n'est
   ni une réussite ni un problème. */
const TON_GENERATION: Record<string, "neutre" | "succes" | "alerte"> = {
  pending: "neutre",
  running: "neutre",
  succeeded: "succes",
  failed: "alerte",
};

/**
 * Écran de validation (UX/UI §5.4, version socle) :
 * formations en attente de validation + historique des générations IA.
 * L'approbation s'effectue dans l'éditeur de la formation.
 */
export default async function ValidationPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/connexion");

  /* Voir la note de l'écran Sources : relire la file de validation
     relève de la conception, pas de la création. */
  const gestionnaire =
    isEliteAdmin(user.memberships) ||
    organizationsForDesign(user.memberships).length > 0;
  if (!gestionnaire) redirect("/sans-acces");

  const supabase = await createClient();
  const [{ data: enAttente }, { data: generations }] = await Promise.all([
    supabase
      .from("courses")
      .select("id, title, updated_at, organization:organizations(name)")
      .eq("status", "review")
      .order("updated_at", { ascending: false }),
    supabase
      .from("ai_generations")
      .select(
        "id, organization_id, generation_type, brief, status, error_message, created_at, result_course_id, model_name, requester:profiles!ai_generations_requested_by_fkey(full_name)"
      )
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  return (
    <div>
      <Retour href="/accueil" ton="sobre" />
      <PageTitle>Validation</PageTitle>

      <div className="grid gap-4 sm:gap-6 lg:grid-cols-2">
        <section aria-label="Formations en attente de validation">
          <h2 className="mb-3 text-lg font-semibold">
            Formations en attente de validation
          </h2>
          {!enAttente || enAttente.length === 0 ? (
            <EmptyState
              title="Aucune formation en attente"
              hint="Les formations soumises à validation apparaîtront ici."
            />
          ) : (
            <div className="space-y-3">
              {enAttente.map((c) => {
                const org = Array.isArray(c.organization)
                  ? c.organization[0]
                  : c.organization;
                return (
                  <Link key={c.id} href={`/catalogue/${c.id}/modifier`}>
                    <Card className={SURVOL_CARTE}>
                      <p className="font-medium">{c.title}</p>
                      <p className="mt-1 text-xs text-slate-400">
                        {org?.name} · soumise le{" "}
                        {new Date(c.updated_at).toLocaleDateString("fr-FR")}
                      </p>
                      <p className="mt-2 text-sm font-medium text-gold-600">
                        Ouvrir pour approuver, demander des corrections ou rejeter →
                      </p>
                    </Card>
                  </Link>
                );
              })}
            </div>
          )}
        </section>

        <section aria-label="Historique des générations IA">
          <h2 className="mb-3 text-lg font-semibold">Dernières générations IA</h2>
          {!generations || generations.length === 0 ? (
            <EmptyState
              title="Aucune génération pour le moment"
              hint="Lancez l'assistant de création IA depuis le catalogue."
            />
          ) : (
            <div className="space-y-3">
              {generations.map((g) => {
                const requester = Array.isArray(g.requester)
                  ? g.requester[0]
                  : g.requester;
                const brief = (g.brief ?? {}) as { sujet?: string };
                return (
                  <Card key={g.id}>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge ton={TON_GENERATION[g.status] ?? "neutre"}>
                        {STATUT_GENERATION[g.status] ?? g.status}
                      </Badge>
                      <span className="text-xs text-slate-400">
                        {new Date(g.created_at).toLocaleString("fr-FR")} ·{" "}
                        {requester?.full_name ?? "?"} · {g.model_name}
                      </span>
                    </div>
                    <p className="mt-2 line-clamp-2 text-sm text-slate-700">
                      {brief.sujet ?? "(brief non renseigné)"}
                    </p>
                    {g.status === "failed" && g.error_message ? (
                      <p className="mt-1 text-sm text-red-600">{g.error_message}</p>
                    ) : null}
                    {g.result_course_id ? (
                      <p className="mt-2 text-sm">
                        <LienTexte href={`/catalogue/${g.result_course_id}/modifier`}>
                          Ouvrir la formation générée →
                        </LienTexte>
                      </p>
                    ) : null}
                    {/* Même jeu de rôles que la politique RLS
                        `ai_gen_delete` : administrateur ou concepteur
                        de l'organisation concernée. */}
                    {canDesignForOrganization(user.memberships, g.organization_id) ? (
                      <div className="mt-3 border-t border-slate-100 pt-3">
                        <DangerForm
                          action={supprimerGeneration}
                          label="Supprimer cette trace"
                          confirmLabel="Confirmer la suppression"
                          pendingLabel="Suppression…"
                          question={
                            g.result_course_id
                              ? "La formation générée est conservée : seule la trace de l'appel au modèle est effacée."
                              : "Effacer définitivement cette trace de génération ?"
                          }
                        >
                          <input type="hidden" name="generation_id" value={g.id} />
                        </DangerForm>
                      </div>
                    ) : null}
                  </Card>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

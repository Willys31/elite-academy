import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/profile";
import { isEliteAdmin } from "@/lib/auth/roles";
import { organizationsForCourseCreation } from "@/lib/courses/statuts";
import { Badge, Card, EmptyState, PageTitle } from "@/components/ui";

export const metadata: Metadata = { title: "Validation" };

const STATUT_GENERATION: Record<string, string> = {
  pending: "En attente",
  running: "En cours",
  succeeded: "Terminée",
  failed: "Échouée",
};

/**
 * Écran de validation (UX/UI §5.4, version socle) :
 * formations en attente de validation + historique des générations IA.
 * L'approbation s'effectue dans l'éditeur de la formation.
 */
export default async function ValidationPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/connexion");

  const gestionnaire =
    isEliteAdmin(user.memberships) ||
    organizationsForCourseCreation(user.memberships).length > 0;
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
        "id, generation_type, brief, status, error_message, created_at, result_course_id, model_name, requester:profiles!ai_generations_requested_by_fkey(full_name)"
      )
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  return (
    <div>
      <PageTitle>Validation</PageTitle>

      <div className="grid gap-6 lg:grid-cols-2">
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
                    <Card className="transition hover:border-brand-300 hover:shadow">
                      <p className="font-medium">{c.title}</p>
                      <p className="mt-1 text-xs text-slate-400">
                        {org?.name} · soumise le{" "}
                        {new Date(c.updated_at).toLocaleDateString("fr-FR")}
                      </p>
                      <p className="mt-2 text-sm text-brand-600">
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
                      <Badge>{STATUT_GENERATION[g.status] ?? g.status}</Badge>
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
                      <Link
                        href={`/catalogue/${g.result_course_id}/modifier`}
                        className="mt-2 inline-block text-sm text-brand-600 hover:underline"
                      >
                        Ouvrir la formation générée →
                      </Link>
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

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/profile";
import { isEliteAdmin } from "@/lib/auth/roles";
import { canManageCompetencies } from "@/lib/courses/statuts";
import { creerCompetence } from "@/app/(app)/competences/actions";
import { AuthForm } from "@/components/ui/AuthForm";
import {
  Alert,
  Badge,
  Card,
  EmptyState,
  Input,
  Label,
  PageTitle,
  Select,
  Textarea,
} from "@/components/ui";

export const metadata: Metadata = { title: "Compétences" };

/**
 * Référentiel de compétences.
 * Les compétences globales (Elite Experience) sont visibles par tous ;
 * chaque organisation gère en plus son propre référentiel.
 */
export default async function CompetencesPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/connexion");

  const supabase = await createClient();
  const { data: competences, error } = await supabase
    .from("competencies")
    .select("id, organization_id, name, domain, description, organization:organizations(name)")
    .order("domain")
    .order("name");

  // Organisations où l'utilisateur peut créer des compétences.
  const orgsGerees = user.memberships.filter((m) =>
    canManageCompetencies(user.memberships, m.organization_id)
  );
  const peutCreerGlobale = isEliteAdmin(user.memberships);
  const peutCreer = peutCreerGlobale || orgsGerees.length > 0;

  return (
    <div>
      <PageTitle>Référentiel de compétences</PageTitle>

      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <section aria-label="Liste des compétences">
          {error ? (
            <Alert kind="error">
              Le chargement des compétences a échoué. Actualisez la page.
            </Alert>
          ) : !competences || competences.length === 0 ? (
            <EmptyState
              title="Aucune compétence pour le moment"
              hint="Créez les premières compétences observables : elles structureront les formations et la progression."
            />
          ) : (
            <div className="space-y-3">
              {competences.map((c) => {
                const org = Array.isArray(c.organization)
                  ? c.organization[0]
                  : c.organization;
                return (
                  <Card key={c.id}>
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="font-semibold">{c.name}</h2>
                      {c.domain ? <Badge>{c.domain}</Badge> : null}
                      <span className="text-xs text-slate-400">
                        {c.organization_id
                          ? `Organisation : ${org?.name ?? ""}`
                          : "Globale (Elite Experience)"}
                      </span>
                    </div>
                    {c.description ? (
                      <p className="mt-1 text-sm text-slate-600">{c.description}</p>
                    ) : null}
                  </Card>
                );
              })}
            </div>
          )}
        </section>

        {peutCreer ? (
          <section aria-label="Créer une compétence">
            <Card>
              <h2 className="mb-3 font-semibold">Nouvelle compétence</h2>
              <AuthForm
                action={creerCompetence}
                submitLabel="Créer la compétence"
                pendingLabel="Création…"
              >
                <div>
                  <Label htmlFor="name">Nom (observable)</Label>
                  <Input
                    id="name"
                    name="name"
                    required
                    placeholder="Ex. : Conduire un entretien de recadrage"
                  />
                </div>
                <div>
                  <Label htmlFor="domain">Domaine</Label>
                  <Input
                    id="domain"
                    name="domain"
                    required
                    placeholder="Ex. : management, santé, banque…"
                  />
                </div>
                <div>
                  <Label htmlFor="description">Description (facultatif)</Label>
                  <Textarea id="description" name="description" rows={3} />
                </div>
                <div>
                  <Label htmlFor="portee">Portée</Label>
                  <Select
                    id="portee"
                    name="portee"
                    required
                    defaultValue={peutCreerGlobale ? "globale" : orgsGerees[0]?.organization_id}
                  >
                    {peutCreerGlobale ? (
                      <option value="globale">Globale (toutes organisations)</option>
                    ) : null}
                    {orgsGerees.map((m) => (
                      <option key={m.organization_id} value={m.organization_id}>
                        {m.organization?.name ?? "Mon organisation"}
                      </option>
                    ))}
                  </Select>
                </div>
              </AuthForm>
            </Card>
          </section>
        ) : null}
      </div>
    </div>
  );
}

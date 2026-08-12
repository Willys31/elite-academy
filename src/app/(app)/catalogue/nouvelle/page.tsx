import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/profile";
import { isEliteAdmin } from "@/lib/auth/roles";
import { organizationsForCourseCreation } from "@/lib/courses/statuts";
import { creerFormation } from "@/app/(app)/catalogue/actions";
import { createClient } from "@/lib/supabase/server";
import { AuthForm } from "@/components/ui/AuthForm";
import { BackLink, Card, Input, Label, PageTitle, Select, Textarea } from "@/components/ui";

export const metadata: Metadata = { title: "Créer une formation" };

export default async function NouvelleFormationPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/connexion");

  const elite = isEliteAdmin(user.memberships);
  let organisations = organizationsForCourseCreation(user.memberships).map((m) => ({
    id: m.organization_id,
    name: m.organization?.name ?? "Organisation",
  }));

  // L'admin Elite Experience peut créer dans toute organisation.
  if (elite) {
    const supabase = await createClient();
    const { data } = await supabase
      .from("organizations")
      .select("id, name")
      .order("name");
    organisations = data ?? organisations;
  }

  if (organisations.length === 0) redirect("/sans-acces");

  return (
    <div className="max-w-2xl">
      <BackLink href="/catalogue">Catalogue</BackLink>
      <PageTitle>Créer une formation</PageTitle>
      <p className="-mt-4 mb-6 text-sm text-slate-500">
        La formation est créée en <strong>brouillon</strong> : vous pourrez
        ensuite ajouter modules, leçons et compétences, puis la soumettre à
        validation avant publication.
      </p>

      <Card>
        <AuthForm
          action={creerFormation}
          submitLabel="Créer la formation (brouillon)"
          pendingLabel="Création en cours…"
        >
          <div>
            <Label htmlFor="organization_id">Organisation</Label>
            <Select id="organization_id" name="organization_id" required>
              {organisations.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="title">Titre</Label>
            <Input
              id="title"
              name="title"
              required
              placeholder="Ex. : Gestion des conflits internes pour managers débutants"
            />
          </div>
          <div>
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              name="description"
              rows={4}
              placeholder="Objectif général, résultat attendu…"
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="context_type">Contexte</Label>
              <Select id="context_type" name="context_type" defaultValue="generic">
                <option value="generic">Générique</option>
                <option value="sector">Sectoriel</option>
                <option value="organization">Entreprise</option>
                <option value="brand">Marque</option>
                <option value="confidential">Confidentiel</option>
              </Select>
            </div>
            <div>
              <Label htmlFor="sector">Secteur (facultatif)</Label>
              <Input id="sector" name="sector" placeholder="Ex. : santé, banque…" />
            </div>
            <div>
              <Label htmlFor="format">Format</Label>
              <Select id="format" name="format" defaultValue="online">
                <option value="online">En ligne</option>
                <option value="in_person">Présentiel</option>
                <option value="hybrid">Hybride</option>
              </Select>
            </div>
            <div>
              <Label htmlFor="duration_minutes">Durée estimée (minutes)</Label>
              <Input
                id="duration_minutes"
                name="duration_minutes"
                type="number"
                min={0}
                placeholder="Ex. : 240"
              />
            </div>
          </div>
        </AuthForm>
      </Card>
    </div>
  );
}

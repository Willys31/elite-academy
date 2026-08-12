import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/profile";
import { canCreateOrganization } from "@/lib/auth/roles";
import { creerOrganisation } from "@/app/(app)/organisations/actions";
import { AuthForm } from "@/components/ui/AuthForm";
import { BackLink, Card, Input, Label, PageTitle, Select } from "@/components/ui";

export const metadata: Metadata = { title: "Créer une organisation" };

export default async function NouvelleOrganisationPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/connexion");
  if (!canCreateOrganization(user.memberships)) redirect("/sans-acces");

  return (
    <div className="max-w-xl">
      <BackLink href="/organisations">Organisations</BackLink>
      <PageTitle>Créer une organisation</PageTitle>
      <Card>
        <AuthForm
          action={creerOrganisation}
          submitLabel="Créer l'organisation"
          pendingLabel="Création en cours…"
        >
          <div>
            <Label htmlFor="name">Nom de l&apos;organisation</Label>
            <Input id="name" name="name" type="text" required />
          </div>
          <div>
            <Label htmlFor="type">Type</Label>
            <Select id="type" name="type" required defaultValue="entreprise">
              <option value="entreprise">Entreprise</option>
              <option value="ecole">École ou université</option>
              <option value="centre_formation">Centre de formation</option>
              <option value="institution">Institution publique</option>
            </Select>
          </div>
          <div>
            <Label htmlFor="sector">Secteur (facultatif)</Label>
            <Input
              id="sector"
              name="sector"
              type="text"
              placeholder="Ex. : santé, banque, restauration…"
            />
          </div>
        </AuthForm>
      </Card>
    </div>
  );
}

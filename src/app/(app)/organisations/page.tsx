import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/profile";
import { canCreateOrganization, ORG_TYPE_LABELS, type OrgType } from "@/lib/auth/roles";
import { Alert, Card, EmptyState, PageTitle, SecondaryLink } from "@/components/ui";

export const metadata: Metadata = { title: "Organisations" };

export default async function OrganisationsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/connexion");

  const supabase = await createClient();
  const { data: organisations, error } = await supabase
    .from("organizations")
    .select("id, name, type, sector, status")
    .order("name");

  return (
    <div>
      <PageTitle
        action={
          canCreateOrganization(user.memberships) ? (
            <SecondaryLink href="/organisations/nouvelle">
              Créer une organisation
            </SecondaryLink>
          ) : undefined
        }
      >
        Organisations
      </PageTitle>

      {error ? (
        <Alert kind="error">
          Le chargement des organisations a échoué. Actualisez la page ou
          réessayez plus tard.
        </Alert>
      ) : !organisations || organisations.length === 0 ? (
        <EmptyState
          title="Aucune organisation visible"
          hint="Vous verrez ici les organisations auxquelles vous êtes rattaché."
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {organisations.map((org) => (
            <Link key={org.id} href={`/organisations/${org.id}`}>
              <Card className="h-full transition hover:border-brand-300 hover:shadow">
                <h2 className="font-semibold text-slate-900">{org.name}</h2>
                <p className="mt-1 text-sm text-slate-500">
                  {ORG_TYPE_LABELS[org.type as OrgType] ?? org.type}
                  {org.sector ? ` · ${org.sector}` : ""}
                </p>
                <p className="mt-2 text-xs text-slate-400">
                  Statut : {org.status === "active" ? "active" : org.status}
                </p>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

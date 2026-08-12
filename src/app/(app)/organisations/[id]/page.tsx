import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/profile";
import {
  canManageMembers,
  ORG_TYPE_LABELS,
  ROLE_LABELS,
  type MemberRole,
  type OrgType,
} from "@/lib/auth/roles";
import { ajouterMembre } from "@/app/(app)/organisations/actions";
import { AuthForm } from "@/components/ui/AuthForm";
import {
  BackLink,
  Badge,
  Card,
  EmptyState,
  Input,
  Label,
  PageTitle,
  Select,
} from "@/components/ui";

export const metadata: Metadata = { title: "Organisation" };

export default async function OrganisationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) redirect("/connexion");

  const supabase = await createClient();

  // La RLS garantit qu'une organisation étrangère n'est pas lisible.
  const { data: org } = await supabase
    .from("organizations")
    .select("id, name, type, sector, status")
    .eq("id", id)
    .maybeSingle();

  if (!org) notFound();

  const gestionnaire = canManageMembers(user.memberships, org.id);

  // La liste des membres n'est visible que selon les droits RLS
  // (admin/manager/trainer de l'organisation ou admin Elite Experience).
  const { data: membres } = gestionnaire
    ? await supabase
        .from("organization_members")
        .select("id, role, status, joined_at, profile:profiles(full_name, email)")
        .eq("organization_id", org.id)
        .order("joined_at")
    : { data: null };

  return (
    <div>
      <BackLink href="/organisations">Organisations</BackLink>
      <PageTitle>{org.name}</PageTitle>
      <p className="-mt-4 mb-6 text-sm text-slate-500">
        {ORG_TYPE_LABELS[org.type as OrgType] ?? org.type}
        {org.sector ? ` · ${org.sector}` : ""}
      </p>

      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <section aria-label="Membres">
          <h2 className="mb-3 text-lg font-semibold">Membres</h2>
          {!gestionnaire ? (
            <EmptyState
              title="Liste des membres non disponible"
              hint="Seuls les responsables et administrateurs de l'organisation peuvent consulter la liste des membres."
            />
          ) : !membres || membres.length === 0 ? (
            <EmptyState
              title="Aucun membre pour le moment"
              hint="Ajoutez un premier membre à partir de son adresse e-mail."
            />
          ) : (
            <Card className="overflow-x-auto p-0">
              {/* Tableau sur grand écran, cartes empilées sur mobile */}
              <table className="hidden w-full text-left text-sm sm:table">
                <thead className="border-b border-slate-200 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Nom</th>
                    <th className="px-4 py-3">E-mail</th>
                    <th className="px-4 py-3">Rôle</th>
                    <th className="px-4 py-3">Statut</th>
                  </tr>
                </thead>
                <tbody>
                  {membres.map((m) => {
                    const profil = Array.isArray(m.profile)
                      ? m.profile[0]
                      : m.profile;
                    return (
                      <tr key={m.id} className="border-b border-slate-100 last:border-0">
                        <td className="px-4 py-3 font-medium">
                          {profil?.full_name || "—"}
                        </td>
                        <td className="px-4 py-3 text-slate-600">
                          {profil?.email}
                        </td>
                        <td className="px-4 py-3">
                          <Badge>{ROLE_LABELS[m.role as MemberRole]}</Badge>
                        </td>
                        <td className="px-4 py-3 text-slate-500">{m.status}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <ul className="divide-y divide-slate-100 sm:hidden">
                {membres.map((m) => {
                  const profil = Array.isArray(m.profile)
                    ? m.profile[0]
                    : m.profile;
                  return (
                    <li key={m.id} className="p-4">
                      <p className="font-medium">{profil?.full_name || "—"}</p>
                      <p className="text-sm text-slate-600">{profil?.email}</p>
                      <p className="mt-1">
                        <Badge>{ROLE_LABELS[m.role as MemberRole]}</Badge>
                      </p>
                    </li>
                  );
                })}
              </ul>
            </Card>
          )}
        </section>

        {gestionnaire ? (
          <section aria-label="Ajouter un membre">
            <h2 className="mb-3 text-lg font-semibold">Ajouter un membre</h2>
            <Card>
              <AuthForm
                action={ajouterMembre}
                submitLabel="Ajouter le membre"
                pendingLabel="Ajout en cours…"
              >
                <input type="hidden" name="organization_id" value={org.id} />
                <div>
                  <Label htmlFor="email">Adresse e-mail du membre</Label>
                  <Input
                    id="email"
                    name="email"
                    type="email"
                    required
                    placeholder="membre@exemple.com"
                  />
                  <p className="mt-1 text-xs text-slate-500">
                    La personne doit d&apos;abord avoir créé son compte.
                  </p>
                </div>
                <div>
                  <Label htmlFor="role">Rôle</Label>
                  <Select id="role" name="role" required defaultValue="learner">
                    <option value="learner">Apprenant</option>
                    <option value="trainer">Formateur</option>
                    <option value="designer">Concepteur pédagogique</option>
                    <option value="manager">Responsable d&apos;organisation</option>
                    <option value="admin">Administrateur</option>
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

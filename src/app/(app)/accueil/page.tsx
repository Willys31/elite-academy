import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/profile";
import {
  activeMemberships,
  isEliteAdmin,
  primaryRole,
  ROLE_LABELS,
} from "@/lib/auth/roles";
import { Badge, Card, EmptyState, PageTitle, SecondaryLink } from "@/components/ui";

export const metadata: Metadata = { title: "Accueil" };

/**
 * Écran d'accueil par rôle (version socle).
 * Les blocs correspondant aux lots suivants (formations, sessions,
 * révision, statistiques) sont présentés comme « à venir » afin de
 * ne pas simuler des fonctions inexistantes.
 */
export default async function AccueilPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/connexion");

  const memberships = activeMemberships(user.memberships);
  const role = primaryRole(user.memberships);

  return (
    <div>
      <PageTitle>
        Bonjour{user.fullName ? ` ${user.fullName}` : ""}
      </PageTitle>

      {/* Situation du compte */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card>
          <h2 className="text-sm font-semibold text-slate-700">Votre rôle</h2>
          <p className="mt-2 text-lg font-medium">{ROLE_LABELS[role]}</p>
          {isEliteAdmin(user.memberships) ? (
            <p className="mt-1 text-sm text-slate-500">
              Administrateur de la plateforme Elite Experience
            </p>
          ) : null}
        </Card>

        <Card>
          <h2 className="text-sm font-semibold text-slate-700">
            Vos organisations
          </h2>
          {memberships.length === 0 ? (
            <p className="mt-2 text-sm text-slate-500">
              Vous n&apos;êtes rattaché à aucune organisation pour le moment.
            </p>
          ) : (
            <ul className="mt-2 space-y-2">
              {memberships.map((m) => (
                <li key={m.organization_id} className="flex items-center gap-2">
                  <span className="text-sm">
                    {m.organization?.name ?? "Organisation"}
                  </span>
                  <Badge>{ROLE_LABELS[m.role]}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <h2 className="text-sm font-semibold text-slate-700">
            Prochaine étape
          </h2>
          <p className="mt-2 text-sm text-slate-600">
            {memberships.length === 0
              ? "Demandez à votre responsable ou à Elite Experience de vous rattacher à une organisation."
              : "Les formations, sessions et tableaux de bord arriveront dans les prochains lots."}
          </p>
        </Card>
      </div>

      {/* Sections à venir, sans simulation de données */}
      <div className="mt-8 grid gap-4 lg:grid-cols-2">
        <EmptyState
          title="Formations et progression"
          hint="Catalogue, parcours par compétences et progression seront livrés dans un prochain lot."
        />
        <Card>
          <h2 className="text-sm font-semibold text-slate-700">
            Session présentielle
          </h2>
          <p className="mt-2 text-sm text-slate-600">
            Votre formateur anime un atelier ? Rejoignez sa session avec le
            code ou le QR code affiché en salle.
          </p>
          <div className="mt-3">
            <SecondaryLink href="/rejoindre">Rejoindre une session</SecondaryLink>
          </div>
        </Card>
      </div>
    </div>
  );
}

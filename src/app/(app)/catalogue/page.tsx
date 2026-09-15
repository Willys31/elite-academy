import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/profile";
import {
  canEditCourse,
  organizationsForCourseCreation,
  STATUS_LABELS,
  TON_STATUT,
  FORMAT_LABELS,
  type CourseStatus,
} from "@/lib/courses/statuts";
import { isEliteAdmin } from "@/lib/auth/roles";
import { Alert, Badge, Card, EmptyState, Input, PageTitle, PrimaryButton, Retour, SURVOL_CARTE, SecondaryLink, Select } from "@/components/ui";

export const metadata: Metadata = { title: "Catalogue" };

const STATUTS: CourseStatus[] = ["draft", "review", "approved", "published", "archived"];

/**
 * Catalogue :
 * - vue gestion (tous statuts, filtre, accès éditeur) pour les
 *   administrateurs et concepteurs ;
 * - vue consultation (formations publiées) pour les autres rôles.
 * La RLS filtre déjà côté base ; l'interface n'ajoute que du confort.
 */
export default async function CataloguePage({
  searchParams,
}: {
  searchParams: Promise<{ statut?: string; q?: string; supprimee?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/connexion");
  const params = await searchParams;

  /* Deux droits distincts, longtemps confondus dans un seul
     « estGestionnaire » :
     - CRÉER : ouvert au formateur depuis la migration 0010, c'est lui
       qui commande les boutons Assistant IA / Importer / Créer ;
     - MODIFIER : se juge formation par formation (propriétaire, ou
       admin/concepteur de l'organisation), donc plus bas, carte par
       carte. Les confondre envoyait un formateur vers l'éditeur d'une
       formation qu'il n'a pas le droit de toucher. */
  const peutCreer =
    isEliteAdmin(user.memberships) ||
    organizationsForCourseCreation(user.memberships).length > 0;

  const supabase = await createClient();
  let requete = supabase
    .from("courses")
    .select(
      "id, title, description, status, sector, format, duration_minutes, organization_id, owner_id, organization:organizations(name)"
    )
    .order("updated_at", { ascending: false });

  if (!peutCreer) {
    requete = requete.eq("status", "published");
  } else if (params.statut && STATUTS.includes(params.statut as CourseStatus)) {
    requete = requete.eq("status", params.statut);
  }
  if (params.q) {
    requete = requete.ilike("title", `%${params.q}%`);
  }

  const { data: formations, error } = await requete;

  return (
    <div>
      <Retour href="/accueil" ton="sobre" />
      <PageTitle
        action={
          peutCreer ? (
            <div className="flex flex-wrap gap-2">
              <SecondaryLink href="/catalogue/assistant">
                Assistant IA
              </SecondaryLink>
              <SecondaryLink href="/catalogue/importer">
                Importer un document
              </SecondaryLink>
              <SecondaryLink href="/catalogue/nouvelle">
                Créer manuellement
              </SecondaryLink>
            </div>
          ) : undefined
        }
      >
        Catalogue
      </PageTitle>

      {params.supprimee ? (
        <div className="mb-6">
          <Alert kind="success">Formation supprimée définitivement.</Alert>
        </div>
      ) : null}

      {/* Recherche + filtre statut */}
      <form method="get" className="mb-6 flex flex-wrap items-end gap-3">
        <div className="min-w-48 flex-1">
          <label htmlFor="q" className="mb-1.5 block text-sm font-medium text-ink-900">
            Rechercher
          </label>
          <Input
            id="q"
            name="q"
            defaultValue={params.q ?? ""}
            placeholder="Titre de formation…"
          />
        </div>
        {peutCreer ? (
          <div>
            <label htmlFor="statut" className="mb-1.5 block text-sm font-medium text-ink-900">
              Statut
            </label>
            <Select id="statut" name="statut" defaultValue={params.statut ?? ""}>
              <option value="">Tous</option>
              {STATUTS.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABELS[s]}
                </option>
              ))}
            </Select>
          </div>
        ) : null}
        <PrimaryButton type="submit">Filtrer</PrimaryButton>
      </form>

      {error ? (
        <Alert kind="error">
          Le chargement du catalogue a échoué. Actualisez la page.
        </Alert>
      ) : !formations || formations.length === 0 ? (
        <EmptyState
          title="Aucune formation trouvée"
          hint={
            peutCreer
              ? "Créez votre première formation ou modifiez les filtres."
              : "Aucune formation publiée ne correspond à votre recherche pour le moment."
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {formations.map((f) => {
            const org = Array.isArray(f.organization)
              ? f.organization[0]
              : f.organization;
            // Éditeur si cette formation précise m'appartient ou relève
            // de mon rôle ; sinon la fiche en consultation.
            const peutEditer = canEditCourse(
              user.memberships,
              f.organization_id as string,
              (f.owner_id as string) ?? null,
              user.id
            );
            return (
              <Link
                key={f.id}
                href={
                  peutEditer
                    ? `/catalogue/${f.id}/modifier`
                    : `/catalogue/${f.id}`
                }
              >
                <Card className={`h-full ${SURVOL_CARTE}`}>
                  {/* La pastille passe AU-DESSUS du titre. Côte à côte,
                      un statut long (« En attente de validation »)
                      écrasait le titre jusqu'à le couper en plein mot :
                      « Techni / ques de / vente ». Empilés, chacun
                      dispose de toute la largeur. */}
                  {peutCreer ? (
                    <div className="mb-2">
                      <Badge ton={TON_STATUT[f.status as CourseStatus]}>
                        {STATUS_LABELS[f.status as CourseStatus]}
                      </Badge>
                    </div>
                  ) : null}
                  <h2 className="font-display text-lg font-semibold tracking-tight text-ink-900">
                    {f.title}
                  </h2>
                  {f.description ? (
                    <p className="mt-1 line-clamp-2 text-sm text-slate-600">
                      {f.description}
                    </p>
                  ) : null}
                  <p className="mt-2 text-xs text-slate-400">
                    {org?.name}
                    {f.sector ? ` · ${f.sector}` : ""}
                    {` · ${FORMAT_LABELS[f.format] ?? f.format}`}
                    {f.duration_minutes ? ` · ${f.duration_minutes} min` : ""}
                  </p>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

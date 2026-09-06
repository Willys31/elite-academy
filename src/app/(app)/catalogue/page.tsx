import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/profile";
import {
  organizationsForCourseCreation,
  STATUS_LABELS,
  FORMAT_LABELS,
  type CourseStatus,
} from "@/lib/courses/statuts";
import { isEliteAdmin } from "@/lib/auth/roles";
import {
  Alert,
  Badge,
  Card,
  EmptyState,
  PageTitle,
  SecondaryLink,
} from "@/components/ui";

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
  searchParams: Promise<{ statut?: string; q?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/connexion");
  const params = await searchParams;

  const estGestionnaire =
    isEliteAdmin(user.memberships) ||
    organizationsForCourseCreation(user.memberships).length > 0;

  const supabase = await createClient();
  let requete = supabase
    .from("courses")
    .select(
      "id, title, description, status, sector, format, duration_minutes, organization:organizations(name)"
    )
    .order("updated_at", { ascending: false });

  if (!estGestionnaire) {
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
      <PageTitle
        action={
          estGestionnaire ? (
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

      {/* Recherche + filtre statut */}
      <form method="get" className="mb-6 flex flex-wrap items-end gap-3">
        <div className="min-w-48 flex-1">
          <label htmlFor="q" className="mb-1 block text-sm font-medium text-slate-700">
            Rechercher
          </label>
          <input
            id="q"
            name="q"
            defaultValue={params.q ?? ""}
            placeholder="Titre de formation…"
            className="block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-200"
          />
        </div>
        {estGestionnaire ? (
          <div>
            <label htmlFor="statut" className="mb-1 block text-sm font-medium text-slate-700">
              Statut
            </label>
            <select
              id="statut"
              name="statut"
              defaultValue={params.statut ?? ""}
              className="block rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm"
            >
              <option value="">Tous</option>
              {STATUTS.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        <button
          type="submit"
          className="min-h-11 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
        >
          Filtrer
        </button>
      </form>

      {error ? (
        <Alert kind="error">
          Le chargement du catalogue a échoué. Actualisez la page.
        </Alert>
      ) : !formations || formations.length === 0 ? (
        <EmptyState
          title="Aucune formation trouvée"
          hint={
            estGestionnaire
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
            return (
              <Link
                key={f.id}
                href={
                  estGestionnaire
                    ? `/catalogue/${f.id}/modifier`
                    : `/catalogue/${f.id}`
                }
              >
                <Card className="h-full transition hover:border-brand-300 hover:shadow">
                  <div className="flex items-start justify-between gap-2 [&>:last-child]:shrink-0">
                    <h2 className="min-w-0 font-semibold text-slate-900">{f.title}</h2>
                    {estGestionnaire ? (
                      <Badge>{STATUS_LABELS[f.status as CourseStatus]}</Badge>
                    ) : null}
                  </div>
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

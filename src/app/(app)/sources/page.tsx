import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/profile";
import { isEliteAdmin } from "@/lib/auth/roles";
import {
  canCreateCourse,
  organizationsForCourseCreation,
} from "@/lib/courses/statuts";
import { supprimerSource } from "@/app/(app)/sources/actions";
import { DangerForm } from "@/components/ui/DangerForm";
import {
  Badge,
  Card,
  EmptyState,
  PageTitle,
  SecondaryLink,
} from "@/components/ui";

export const metadata: Metadata = { title: "Sources" };

/** Libellés lisibles des formats importés. */
const FORMATS: Record<string, string> = {
  "application/pdf": "PDF",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "Word",
  "application/msword": "Word",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "PowerPoint",
  "application/vnd.ms-powerpoint": "PowerPoint",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "Excel",
  "text/plain": "Texte",
  "text/markdown": "Markdown",
  "image/png": "Image",
  "image/jpeg": "Image",
  "image/webp": "Image",
  "video/mp4": "Vidéo",
  "audio/mpeg": "Audio",
};

/**
 * Documents importés (schéma §8, PRD §5) : traçabilité de ce qui a été
 * versé dans la plateforme, et ménage.
 *
 * Un document encore rattaché à une leçon n'est pas supprimable ici :
 * aucune clé étrangère ne relie l'activité à la source, la base
 * laisserait donc la leçon pointer vers un fichier disparu. Le retrait
 * se fait alors depuis l'éditeur de la formation, qui supprime les deux
 * ensemble.
 */
export default async function SourcesPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/connexion");

  const gestionnaire =
    isEliteAdmin(user.memberships) ||
    organizationsForCourseCreation(user.memberships).length > 0;
  if (!gestionnaire) redirect("/sans-acces");

  const supabase = await createClient();
  const { data: sources } = await supabase
    .from("sources")
    .select(
      `id, organization_id, title, mime_type, source_type, status, created_at,
       owner:profiles!sources_owner_id_fkey(full_name),
       organization:organizations(name)`
    )
    .order("created_at", { ascending: false })
    .limit(100);

  // Un seul aller-retour pour savoir quels documents servent encore de
  // support : interroger activité par activité multiplierait les
  // requêtes pour une information d'affichage.
  const { data: usages } = await supabase
    .from("activities")
    .select("id, content")
    .eq("type", "file");

  const utilisees = new Set(
    (usages ?? [])
      .map((a) => (a.content as { source_id?: string } | null)?.source_id)
      .filter((id): id is string => Boolean(id))
  );

  return (
    <div>
      <PageTitle
        action={
          <SecondaryLink href="/catalogue/importer">
            Importer un document
          </SecondaryLink>
        }
      >
        Sources
      </PageTitle>

      <p className="-mt-4 mb-6 text-sm text-slate-500">
        Documents versés dans la plateforme : imports de cours et supports
        de leçon. {sources?.length ?? 0} document
        {(sources?.length ?? 0) > 1 ? "s" : ""} affiché
        {(sources?.length ?? 0) > 1 ? "s" : ""}.
      </p>

      {!sources || sources.length === 0 ? (
        <EmptyState
          title="Aucun document importé"
          hint="Les fichiers versés depuis « Importer un document » ou depuis une leçon apparaîtront ici."
        />
      ) : (
        <div className="space-y-3">
          {sources.map((s) => {
            const owner = Array.isArray(s.owner) ? s.owner[0] : s.owner;
            const org = Array.isArray(s.organization)
              ? s.organization[0]
              : s.organization;
            const estUtilisee = utilisees.has(s.id);
            const peutSupprimer = canCreateCourse(user.memberships, s.organization_id);

            return (
              <Card key={s.id}>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <p className="font-medium break-words">{s.title}</p>
                    <p className="mt-1 text-xs text-slate-400">
                      {FORMATS[s.mime_type] ?? s.mime_type}
                      {org?.name ? ` · ${org.name}` : ""}
                      {owner?.full_name ? ` · ${owner.full_name}` : ""}
                      {` · ${new Date(s.created_at).toLocaleDateString("fr-FR")}`}
                    </p>
                  </div>
                  {estUtilisee ? <Badge>Utilisé dans une leçon</Badge> : null}
                </div>

                {peutSupprimer ? (
                  <div className="mt-3 border-t border-slate-100 pt-3">
                    {estUtilisee ? (
                      <p className="text-sm text-slate-500">
                        Ce document sert de support à une leçon. Retirez-le
                        depuis l&apos;
                        <Link
                          href="/catalogue"
                          className="text-brand-600 hover:underline"
                        >
                          éditeur de la formation
                        </Link>
                        {" "}: le fichier et sa trace y sont supprimés ensemble.
                      </p>
                    ) : (
                      <DangerForm
                        action={supprimerSource}
                        label="Supprimer le document"
                        confirmLabel="Confirmer la suppression"
                        pendingLabel="Suppression…"
                        question={`Supprimer définitivement « ${s.title} » et son fichier ?`}
                      >
                        <input type="hidden" name="source_id" value={s.id} />
                      </DangerForm>
                    )}
                  </div>
                ) : null}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/profile";
import { isEliteAdmin } from "@/lib/auth/roles";
import {
  canDesignForOrganization,
  organizationsForDesign,
} from "@/lib/courses/statuts";
import { supprimerSource } from "@/app/(app)/sources/actions";
import { lireUsagesStockage } from "@/lib/stockage/usage";
import { formaterTaille } from "@/lib/stockage/limites";
import { JaugeStockage } from "@/components/stockage/JaugeStockage";
import { DangerForm } from "@/components/ui/DangerForm";
import { Badge, Card, EmptyState, PageTitle, Retour, SecondaryLink } from "@/components/ui";

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
  "video/webm": "Vidéo",
  "video/quicktime": "Vidéo",
  "audio/mpeg": "Audio",
  "audio/mp4": "Audio",
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
export default async function SourcesPage({
  searchParams,
}: {
  searchParams: Promise<{ extraits?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/connexion");
  const { extraits } = await searchParams;
  const afficherExtraits = extraits === "1";

  /* La bibliothèque de sources appartient à la conception, pas à la
     création : un formateur crée ses formations depuis la migration
     0010, mais `sources_delete` en base ne connaît qu'admin et
     concepteur. Utiliser ici le test de création afficherait des
     boutons que la base refuse. */
  const gestionnaire =
    isEliteAdmin(user.memberships) ||
    organizationsForDesign(user.memberships).length > 0;
  if (!gestionnaire) redirect("/sans-acces");

  const supabase = await createClient();
  // Les extraits de leçons (lot 21) peuvent décupler la liste : masqués
  // par défaut, affichés à la demande (?extraits=1).
  let requeteSources = supabase
    .from("sources")
    .select(
      `id, organization_id, title, mime_type, source_type, status, created_at,
       size_bytes, upload_status,
       owner:profiles!sources_owner_id_fkey(full_name),
       organization:organizations(name)`
    )
    .order("created_at", { ascending: false })
    .limit(100);
  if (!afficherExtraits) requeteSources = requeteSources.neq("source_type", "extrait_import");
  const [{ data: sources }, { count: nbExtraits }, { data: leconsSourcees }] = await Promise.all([
    requeteSources,
    supabase
      .from("sources")
      .select("id", { count: "exact", head: true })
      .eq("source_type", "extrait_import"),
    supabase.from("lessons").select("content").not("content->source", "is", null),
  ]);

  // Nombre de leçons qui renvoient à chaque document d'import.
  const leconsParSource = new Map<string, number>();
  for (const l of leconsSourcees ?? []) {
    const id = (l.content as { source?: { source_id?: string } } | null)?.source?.source_id;
    if (id) leconsParSource.set(id, (leconsParSource.get(id) ?? 0) + 1);
  }

  // Jauges de stockage : une par organisation gérée (toutes pour
  // l'admin Elite). Le quota se mesure sur les fichiers prêts et les
  // envois en cours de moins de 24 h (migration 0018).
  let organisationsGerees: Array<{ id: string; name: string }> = organizationsForDesign(
    user.memberships
  ).map((m) => ({ id: m.organization_id, name: m.organization?.name ?? "Organisation" }));
  if (isEliteAdmin(user.memberships)) {
    const { data } = await supabase.from("organizations").select("id, name").order("name");
    organisationsGerees = data ?? organisationsGerees;
  }
  const usagesStockage = await lireUsagesStockage(
    supabase,
    organisationsGerees.map((o) => o.id)
  );

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
      <Retour href="/accueil" ton="sobre" />
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
        {(nbExtraits ?? 0) > 0 ? (
          <>
            {" "}
            {afficherExtraits ? (
              <Link href="/sources" className="text-brand-700 underline">
                Masquer les {nbExtraits} extraits de leçons
              </Link>
            ) : (
              <Link href="/sources?extraits=1" className="text-brand-700 underline">
                Afficher les {nbExtraits} extraits de leçons
              </Link>
            )}
          </>
        ) : null}
      </p>

      {organisationsGerees.length > 0 ? (
        <section aria-label="Stockage" className="mb-6">
          <h2 className="mb-3 text-lg font-semibold">Stockage</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {organisationsGerees.map((o) => {
              const u = usagesStockage.get(o.id);
              return (
                <Card key={o.id}>
                  <p className="mb-2 truncate text-sm font-medium">{o.name}</p>
                  <JaugeStockage usage={u?.usage ?? 0} quota={u?.quota ?? 0} compact />
                </Card>
              );
            })}
          </div>
        </section>
      ) : null}

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
            const nbLecons = leconsParSource.get(s.id) ?? 0;
            const estSourceDeLecons = nbLecons > 0;
            const peutSupprimer = canDesignForOrganization(user.memberships, s.organization_id);

            return (
              <Card key={s.id}>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <p className="font-medium break-words">{s.title}</p>
                    <p className="mt-1 text-xs text-slate-400">
                      {FORMATS[s.mime_type] ?? s.mime_type}
                      {s.size_bytes ? ` · ${formaterTaille(Number(s.size_bytes))}` : ""}
                      {org?.name ? ` · ${org.name}` : ""}
                      {owner?.full_name ? ` · ${owner.full_name}` : ""}
                      {` · ${new Date(s.created_at).toLocaleDateString("fr-FR")}`}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {s.upload_status === "pending" ? (
                      <Badge ton="or">Téléversement en cours</Badge>
                    ) : s.upload_status === "failed" ? (
                      <Badge ton="alerte">Échec du téléversement</Badge>
                    ) : null}
                    {s.source_type === "document_import" ? <Badge ton="succes">Document d&apos;import</Badge> : null}
                    {s.source_type === "extrait_import" ? <Badge>Extrait</Badge> : null}
                    {estSourceDeLecons ? (
                      <Badge ton="or">
                        Source de {nbLecons} leçon{nbLecons > 1 ? "s" : ""}
                      </Badge>
                    ) : null}
                    {estUtilisee ? <Badge>Utilisé dans une leçon</Badge> : null}
                  </div>
                </div>

                {peutSupprimer ? (
                  <div className="mt-3 border-t border-slate-100 pt-3">
                    {estSourceDeLecons ? (
                      <p className="text-sm text-slate-500">
                        Ce document est la source des extraits de {nbLecons} leçon
                        {nbLecons > 1 ? "s" : ""}. Il reste nécessaire pour régénérer ces
                        extraits : supprimez la formation, ou retirez l&apos;extrait de chaque
                        leçon depuis l&apos;éditeur, avant de le supprimer.
                      </p>
                    ) : estUtilisee ? (
                      <p className="text-sm text-slate-500">
                        Ce document sert de support à une leçon. Retirez-le
                        depuis l&apos;
                        <Link
                          href="/catalogue"
                          className="font-medium text-ink-900 underline decoration-brand-700/30 underline-offset-[3px] transition duration-200 hover:decoration-brand-800"
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

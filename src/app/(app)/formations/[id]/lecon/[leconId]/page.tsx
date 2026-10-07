import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/profile";
import { donneAcces } from "@/lib/courses/inscriptions";
import { marquerLeconTerminee } from "@/app/(app)/formations/actions";
import { obtenirUrlLecture, type UrlLecture } from "@/lib/stockage/fournisseur";
import { formaterTaille, nomSur } from "@/lib/stockage/limites";
import { libelleIntervalle, type Intervalle } from "@/lib/import/decoupage";
import { AuthForm } from "@/components/ui/AuthForm";
import { Badge, Card, PageTitle } from "@/components/ui";

export const metadata: Metadata = { title: "Leçon" };

/**
 * Lecteur de leçon (UX/UI §3.4) : contenu, activités (QCM),
 * marquage terminé, navigation précédent/suivant.
 */
export default async function LeconPage({
  params,
}: {
  params: Promise<{ id: string; leconId: string }>;
}) {
  const { id, leconId } = await params;
  const user = await getCurrentUser();
  if (!user) redirect("/connexion");

  const supabase = await createClient();
  const { data: formation } = await supabase
    .from("courses")
    .select("id, title, current_version_id")
    .eq("id", id)
    .maybeSingle();
  if (!formation) notFound();

  // Une inscription retirée ou suspendue existe toujours en base :
  // c'est son statut, pas sa présence, qui ouvre le contenu.
  const { data: inscription } = await supabase
    .from("enrollments")
    .select("id, status")
    .eq("course_id", formation.id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!inscription || !donneAcces(inscription.status)) {
    redirect(`/catalogue/${formation.id}`);
  }

  const { data: lecon } = await supabase
    .from("lessons")
    .select("id, title, content, estimated_minutes, module_id, position")
    .eq("id", leconId)
    .maybeSingle();
  if (!lecon) notFound();

  // Navigation précédent / suivant sur l'ensemble ordonné des leçons.
  const { data: modules } = formation.current_version_id
    ? await supabase
        .from("modules")
        .select("id, position, lessons(id, title, position)")
        .eq("course_version_id", formation.current_version_id)
        .order("position")
    : { data: [] };
  const ordonnees = (modules ?? []).flatMap((m) =>
    [...(m.lessons ?? [])].sort((a, b) => a.position - b.position)
  );
  const index = ordonnees.findIndex((l) => l.id === lecon.id);
  const precedente = index > 0 ? ordonnees[index - 1] : null;
  const suivante = index >= 0 && index < ordonnees.length - 1 ? ordonnees[index + 1] : null;

  const [{ data: activites }, { data: progres }] = await Promise.all([
    supabase
      .from("activities")
      .select("id, type, title, difficulty, content")
      .eq("lesson_id", lecon.id)
      .order("position"),
    supabase
      .from("progress_records")
      .select("id")
      .eq("user_id", user.id)
      .eq("lesson_id", lecon.id)
      .maybeSingle(),
  ]);

  const contenu = (lecon.content ?? {}) as { text?: string };
  const terminee = Boolean(progres);

  // Supports de la leçon : URL signées (1 h), accès contrôlé par
  // les politiques Storage de l'organisation. `obtenirUrlLecture`
  // isole le fournisseur (Supabase aujourd'hui, Cloudflare Stream
  // plus tard) : la page ne connaît qu'un type d'URL.
  const quizzes = (activites ?? []).filter((a) => a.type === "quiz");
  const fichiers = (activites ?? []).filter((a) => a.type === "file");
  const idsSources = fichiers
    .map((a) => (a.content as { source_id?: string } | null)?.source_id)
    .filter((id): id is string => Boolean(id));
  const { data: sourcesSupports } = idsSources.length
    ? await supabase
        .from("sources")
        .select("id, file_path, mime_type, size_bytes, storage_provider, provider_ref")
        .in("id", idsSources)
    : { data: [] as Array<{
        id: string;
        file_path: string;
        mime_type: string;
        size_bytes: number | null;
        storage_provider: string | null;
        provider_ref: string | null;
      }> };
  const sourceParId = new Map((sourcesSupports ?? []).map((s) => [s.id, s]));

  const supports = await Promise.all(
    fichiers.map(async (a) => {
      const c = (a.content ?? {}) as {
        file_path?: string;
        mime_type?: string;
        source_id?: string;
        range?: Intervalle;
      };
      const source = c.source_id ? sourceParId.get(c.source_id) : undefined;
      const chemin = source?.file_path ?? c.file_path;
      if (!chemin) return null;
      const lecture = await obtenirUrlLecture(supabase, {
        file_path: chemin,
        mime_type: source?.mime_type ?? c.mime_type ?? "application/octet-stream",
        storage_provider: source?.storage_provider,
        provider_ref: source?.provider_ref,
      }, { nomTelechargement: nomSur(chemin.slice(chemin.lastIndexOf("/") + 1).replace(/^[0-9a-f-]{36}-/, "")) });
      if (!lecture) return null;
      return {
        id: a.id,
        titre: a.title,
        lecture,
        mime: source?.mime_type ?? c.mime_type ?? "application/octet-stream",
        taille: source?.size_bytes ? Number(source.size_bytes) : null,
        range: c.range ?? null,
      };
    })
  ).then((liste) => liste.filter(Boolean) as Array<{
    id: string;
    titre: string;
    lecture: UrlLecture;
    mime: string;
    taille: number | null;
    range: Intervalle | null;
  }>);

  return (
    <div className="mx-auto max-w-3xl">
      <p className="mb-2 text-sm">
        <Link href={`/formations/${formation.id}`} className="text-brand-600 hover:underline">
          ← {formation.title}
        </Link>
      </p>
      <PageTitle action={terminee ? <Badge>Terminée</Badge> : undefined}>
        {lecon.title}
      </PageTitle>

      <Card>
        {contenu.text ? (
          <div className="whitespace-pre-line text-[15px] leading-relaxed text-slate-800">
            {contenu.text}
          </div>
        ) : (
          <p className="text-sm text-slate-500">
            Cette leçon n&apos;a pas encore de contenu rédigé.
          </p>
        )}
      </Card>

      {supports.length > 0 ? (
        <section aria-label="Supports de cours" className="mt-6 space-y-4">
          <h2 className="text-lg font-semibold">Supports de la leçon</h2>
          {supports.map((s) => (
            <Card key={s.id} flush className="overflow-hidden">
              <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-2.5">
                <p className="truncate text-sm font-medium">📎 {s.titre}</p>
                {s.lecture.type === "fichier" ? (
                  <span className="flex shrink-0 items-center gap-3 text-sm">
                    <a
                      href={s.lecture.url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-brand-600 hover:underline"
                    >
                      Ouvrir
                    </a>
                    <a href={s.lecture.urlTelechargement} className="text-brand-600 hover:underline">
                      Télécharger{s.taille ? ` (${formaterTaille(s.taille)})` : ""}
                    </a>
                  </span>
                ) : null}
              </div>
              {s.lecture.type === "iframe" || s.lecture.type === "hls" ? (
                <iframe
                  src={s.lecture.url}
                  title={s.titre}
                  allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture; fullscreen"
                  allowFullScreen
                  className="aspect-video w-full bg-black"
                />
              ) : s.mime === "application/pdf" ? (
                <iframe
                  src={s.lecture.url}
                  title={s.titre}
                  className="h-[60svh] min-h-80 w-full sm:h-[70svh]"
                />
              ) : s.mime.startsWith("image/") ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={s.lecture.url} alt={s.titre} className="w-full" />
              ) : s.mime.startsWith("video/") ? (
                /* `preload="metadata"` : le navigateur ne lit que l'en-tête
                   puis avance par requêtes Range ; une vidéo de plusieurs
                   Go ne se télécharge pas entière à l'ouverture. */
                <video
                  src={s.lecture.url}
                  controls
                  preload="metadata"
                  playsInline
                  className="aspect-video w-full bg-black"
                />
              ) : s.mime.startsWith("audio/") ? (
                <audio src={s.lecture.url} controls preload="metadata" className="w-full px-4 py-3" />
              ) : s.range ? (
                /* Extrait d'un PowerPoint : les diapositives de la leçon,
                   à ouvrir dans PowerPoint ou LibreOffice. */
                <p className="px-4 py-3 text-sm text-slate-600">
                  {libelleIntervalle(s.range)} du support d&apos;origine, à télécharger
                  pour les consulter dans PowerPoint.
                </p>
              ) : (
                <p className="px-4 py-3 text-sm text-slate-500">
                  Ce format (Word, PowerPoint…) s&apos;ouvre via le bouton
                  « Télécharger » ci-dessus.
                </p>
              )}
            </Card>
          ))}
        </section>
      ) : null}

      {quizzes.length > 0 ? (
        <section aria-label="Activités" className="mt-6">
          <h2 className="mb-3 text-lg font-semibold">Activités de la leçon</h2>
          <div className="space-y-2">
            {quizzes.map((a) => (
              <Link
                key={a.id}
                href={`/formations/${formation.id}/activite/${a.id}`}
                className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm transition hover:border-brand-300"
              >
                <span>📝 QCM — {a.title}</span>
                <span className="text-xs text-slate-400">
                  Difficulté {a.difficulty}/5
                </span>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        {precedente ? (
          <Link
            href={`/formations/${formation.id}/lecon/${precedente.id}`}
            className="inline-flex min-h-11 items-center rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            ← Précédente
          </Link>
        ) : (
          <span />
        )}

        {!terminee ? (
          <AuthForm
            action={marquerLeconTerminee}
            submitLabel="Marquer comme terminée"
            pendingLabel="Enregistrement…"
          >
            <input type="hidden" name="course_id" value={formation.id} />
            <input type="hidden" name="lesson_id" value={lecon.id} />
          </AuthForm>
        ) : null}

        {suivante ? (
          <Link
            href={`/formations/${formation.id}/lecon/${suivante.id}`}
            className="inline-flex min-h-11 items-center rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
          >
            Suivante →
          </Link>
        ) : (
          <Link
            href={`/formations/${formation.id}`}
            className="inline-flex min-h-11 items-center rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
          >
            Retour au sommaire
          </Link>
        )}
      </div>
    </div>
  );
}

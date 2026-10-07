import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Crée une activité « support » (type `file`) rattachée à une leçon.
 * Le contenu reprend le chemin et le type du fichier pour que la page
 * de la leçon s'affiche même sans jointure sur `sources`.
 */
export async function creerActiviteSupport(
  supabase: SupabaseClient,
  params: {
    lessonId: string;
    titre: string;
    chemin: string;
    mime: string;
    sourceId: string;
  }
) {
  const { count } = await supabase
    .from("activities")
    .select("id", { count: "exact", head: true })
    .eq("lesson_id", params.lessonId);

  return supabase.from("activities").insert({
    lesson_id: params.lessonId,
    type: "file",
    title: params.titre,
    content: {
      file_path: params.chemin,
      mime_type: params.mime,
      source_id: params.sourceId,
    },
    position: (count ?? 0) + 1,
    status: "draft",
  });
}

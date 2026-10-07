import "server-only";

import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, type CurrentUser } from "@/lib/auth/profile";
import { isContentEditable, type CourseStatus } from "@/lib/courses/statuts";

export type ContexteEdition =
  | { erreur: string }
  | {
      user: CurrentUser;
      supabase: Awaited<ReturnType<typeof createClient>>;
      course: {
        id: string;
        organization_id: string;
        status: string;
        current_version_id: string | null;
      };
    };

/**
 * Contexte d'édition d'une formation : utilisateur connecté, client
 * Supabase et formation lisible, à condition qu'elle soit encore en
 * brouillon. Partagé par le téléversement, le retrait des supports et
 * la retouche du découpage (lot 21).
 *
 * Le type de retour est annoté explicitement : laissé à l'inférence,
 * TypeScript fusionne les deux formes en un seul objet aux propriétés
 * optionnelles, et `"erreur" in ctx` ne discrimine plus rien.
 */
export async function verifierEdition(courseId: string): Promise<ContexteEdition> {
  const user = await getCurrentUser();
  if (!user) return { erreur: "Vous devez être connecté." };
  const supabase = await createClient();
  const { data: course } = await supabase
    .from("courses")
    .select("id, organization_id, status, current_version_id")
    .eq("id", courseId)
    .maybeSingle();
  if (!course) return { erreur: "Formation introuvable ou non autorisée." };
  if (!isContentEditable(course.status as CourseStatus)) {
    return {
      erreur:
        "Le contenu n'est modifiable qu'en brouillon : repassez la formation en brouillon d'abord.",
    };
  }
  return { user, supabase, course };
}

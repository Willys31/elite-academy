"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/profile";
import { canDesignForOrganization } from "@/lib/courses/statuts";
import { creerActiviteSupport } from "@/lib/stockage/activites";
import { verifierEdition } from "@/lib/stockage/edition";
import { lireUsageStockage, purgerTeleversementsAbandonnes } from "@/lib/stockage/usage";
import {
  cheminPour,
  mimePourNom,
  TAILLE_MAX_FICHIER,
  validerDemande,
  type Destination,
} from "@/lib/stockage/limites";

/**
 * Téléversement direct navigateur → Storage (lot 20).
 *
 * Le serveur ne voit jamais les octets : il ouvre un chemin
 * (`preparerTeleversement`), le navigateur envoie le fichier par TUS
 * avec le jeton de l'utilisateur (politiques Storage de la migration
 * 0008), puis le serveur constate l'arrivée et enregistre la taille
 * réelle (`finaliserTeleversement`).
 *
 * Les lignes `sources` passent par le client de l'utilisateur : la
 * politique `sources_insert` et le déclencheur de quota (migration
 * 0018) restent la dernière ligne de défense.
 */

function loguer(contexte: string, error: unknown) {
  const message =
    error instanceof Error ? error.message : (error as { message?: string })?.message;
  if (message) console.error(`[televersement] ${contexte} :`, message);
}

function estDepassementQuota(error: unknown): boolean {
  const message = (error as { message?: string })?.message ?? "";
  return message.includes("quota_stockage_depasse");
}

const MESSAGE_QUOTA =
  "Quota de stockage de l'organisation dépassé. Supprimez des documents ou demandez une extension à Elite Experience.";

export type ResultatPreparation =
  | { ok: true; sourceId: string; chemin: string; mime: string }
  | { ok: false; erreur: string };

export type ResultatFinalisation =
  | { ok: true; taille: number }
  | { ok: false; erreur: string; reprise?: boolean };

/**
 * Étape 1 : vérifie les droits, le format, la taille et le quota, puis
 * réserve un chemin et une ligne `sources` en attente.
 */
export async function preparerTeleversement(entree: {
  organizationId: string;
  nomFichier: string;
  taille: number;
  destination: Destination;
}): Promise<ResultatPreparation> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, erreur: "Vous devez être connecté." };

  const { organizationId, nomFichier, taille, destination } = entree;
  if (!organizationId) return { ok: false, erreur: "Veuillez choisir une organisation." };

  /* Les politiques Storage et `sources_insert` n'acceptent qu'admin et
     concepteur : vérifier ici donne un message lisible plutôt qu'un
     refus RLS au milieu du téléversement. */
  if (!canDesignForOrganization(user.memberships, organizationId)) {
    return {
      ok: false,
      erreur:
        "Seuls un administrateur ou un concepteur de l'organisation peuvent téléverser des fichiers.",
    };
  }

  const supabase = await createClient();

  if (destination.type === "lecon") {
    const ctx = await verifierEdition(destination.courseId);
    if ("erreur" in ctx) return { ok: false, erreur: ctx.erreur };
    if (ctx.course.organization_id !== organizationId) {
      return { ok: false, erreur: "La formation n'appartient pas à cette organisation." };
    }
  }

  // Ménage opportuniste : les téléversements abandonnés libèrent leur
  // place dans le quota avant d'en réserver une nouvelle.
  await purgerTeleversementsAbandonnes(organizationId).catch((e) => loguer("purge", e));

  const { usage, quota } = await lireUsageStockage(supabase, organizationId);
  const refus = validerDemande({
    nom: nomFichier,
    taille,
    destination,
    usageOctets: usage,
    quotaOctets: quota,
  });
  if (refus) return { ok: false, erreur: refus };

  const mime = mimePourNom(nomFichier);
  if (!mime) return { ok: false, erreur: "Format non pris en charge." };

  const chemin = cheminPour({ organizationId, destination, uuid: randomUUID(), nom: nomFichier });

  const { data: source, error } = await supabase
    .from("sources")
    .insert({
      organization_id: organizationId,
      owner_id: user.id,
      title: nomFichier,
      file_path: chemin,
      mime_type: mime,
      source_type: "support_pedagogique",
      size_bytes: taille,
      upload_status: "pending",
      storage_provider: "supabase",
    })
    .select("id")
    .single();

  if (error || !source) {
    loguer("réservation de la source", error);
    if (estDepassementQuota(error)) return { ok: false, erreur: MESSAGE_QUOTA };
    return {
      ok: false,
      erreur:
        "La préparation du téléversement a échoué. Vérifiez que la migration 0018 est appliquée et réessayez.",
    };
  }

  return { ok: true, sourceId: source.id, chemin, mime };
}

/**
 * Étape 2 : constate que l'objet est bien arrivé dans Storage, retient
 * sa taille réelle et, pour un support de leçon, crée l'activité.
 */
export async function finaliserTeleversement(entree: {
  sourceId: string;
  rattachement?: { courseId: string; lessonId: string };
}): Promise<ResultatFinalisation> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, erreur: "Vous devez être connecté." };

  const supabase = await createClient();
  const { data: source } = await supabase
    .from("sources")
    .select("id, organization_id, owner_id, title, file_path, mime_type, upload_status, size_bytes")
    .eq("id", entree.sourceId)
    .maybeSingle();

  if (!source || source.owner_id !== user.id) {
    return { ok: false, erreur: "Téléversement introuvable." };
  }
  if (source.upload_status === "ready") {
    return { ok: true, taille: Number(source.size_bytes ?? 0) };
  }
  if (source.upload_status !== "pending") {
    return { ok: false, erreur: "Ce téléversement a été refusé. Recommencez depuis le début." };
  }

  const { data: info, error: erreurInfo } = await supabase.storage
    .from("supports")
    .info(source.file_path);
  if (erreurInfo || !info) {
    loguer("objet absent", erreurInfo);
    return {
      ok: false,
      reprise: true,
      erreur: "Le fichier n'est pas arrivé entièrement. Reprenez le téléversement.",
    };
  }

  const taille = Number(info.size ?? source.size_bytes ?? 0);
  if (taille <= 0 || taille > TAILLE_MAX_FICHIER) {
    await supabase.storage.from("supports").remove([source.file_path]);
    await supabase.from("sources").update({ upload_status: "failed" }).eq("id", source.id);
    return { ok: false, erreur: "Le fichier reçu a une taille invalide ; il a été supprimé." };
  }

  const { error: erreurMaj } = await supabase
    .from("sources")
    .update({
      upload_status: "ready",
      size_bytes: taille,
      uploaded_at: new Date().toISOString(),
    })
    .eq("id", source.id);

  if (erreurMaj) {
    loguer("finalisation", erreurMaj);
    if (estDepassementQuota(erreurMaj)) {
      // La taille réelle dépasse le quota : le fichier repart.
      await supabase.storage.from("supports").remove([source.file_path]);
      await supabase.from("sources").update({ upload_status: "failed" }).eq("id", source.id);
      return { ok: false, erreur: MESSAGE_QUOTA };
    }
    return { ok: false, erreur: "L'enregistrement du fichier a échoué. Réessayez." };
  }

  if (entree.rattachement) {
    const { courseId, lessonId } = entree.rattachement;
    const ctx = await verifierEdition(courseId);
    if ("erreur" in ctx) return { ok: false, erreur: ctx.erreur };
    if (ctx.course.organization_id !== source.organization_id) {
      return { ok: false, erreur: "La formation n'appartient pas à cette organisation." };
    }

    const { error } = await creerActiviteSupport(ctx.supabase, {
      lessonId,
      titre: source.title.replace(/\.[^.]+$/, ""),
      chemin: source.file_path,
      mime: source.mime_type,
      sourceId: source.id,
    });
    if (error) {
      loguer("activité support", error);
      return {
        ok: false,
        erreur: "Le fichier est stocké mais n'a pas pu être rattaché à la leçon. Réessayez.",
      };
    }
    revalidatePath(`/catalogue/${courseId}/modifier`);
  }

  revalidatePath("/sources");
  return { ok: true, taille };
}

/** Abandon volontaire : la ligne en attente et l'objet éventuel disparaissent. */
export async function annulerTeleversement(entree: { sourceId: string }): Promise<void> {
  const user = await getCurrentUser();
  if (!user) return;

  const supabase = await createClient();
  const { data: source } = await supabase
    .from("sources")
    .select("id, owner_id, file_path, upload_status")
    .eq("id", entree.sourceId)
    .maybeSingle();
  if (!source || source.owner_id !== user.id || source.upload_status !== "pending") return;

  await supabase.from("sources").delete().eq("id", source.id);
  const { error } = await supabase.storage.from("supports").remove([source.file_path]);
  if (error) loguer("retrait de l'objet annulé", error);
  revalidatePath("/sources");
}

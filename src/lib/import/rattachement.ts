import "server-only";

import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  libelleIntervalle,
  type Intervalle,
  type UniteSource,
} from "@/lib/import/decoupage";
import {
  nomExtrait,
  ouvrirDecoupeurPdf,
  ouvrirDecoupeurPptx,
  type DecoupeurExtraits,
} from "@/lib/import/extraits";
import { creerActiviteSupport } from "@/lib/stockage/activites";
import { cheminPour, TAILLE_MAX_EXTRACTION, formaterTaille } from "@/lib/stockage/limites";

/**
 * Rattachement des extraits d'un document d'import aux leçons (lot 21).
 *
 * Invariant : chaque activité `file` possède sa propre ligne `sources`
 * et son propre objet dans le bucket. Un extrait est donc un support
 * comme un autre pour « Retirer », la suppression de la formation et
 * le quota ; seul son `content` porte en plus `derived_from` (le
 * document original) et `range` (pages ou diapositives).
 *
 * Le document original, lui, n'est plus jamais rattaché à une leçon :
 * il reste dans la bibliothèque Sources avec `source_type =
 * 'document_import'`, référencé par `lessons.content.source`.
 */

export interface ContexteExtrait {
  supabase: SupabaseClient;
  userId: string;
  organizationId: string;
  courseId: string;
}

export interface OriginalImport {
  id: string;
  title: string;
  file_path: string;
  mime_type: string;
  kind: UniteSource;
}

/** Position d'une leçon dans son document source, telle que stockée dans `lessons.content.source`. */
export interface SourceLecon {
  source_id: string;
  kind: UniteSource;
  from: number;
  to: number;
  total: number;
}

export type ResultatRattachement =
  | { ok: true; activityId: string | null }
  | { ok: false; erreur: string; quota?: boolean };

function loguer(contexte: string, error: unknown) {
  const message =
    error instanceof Error ? error.message : (error as { message?: string })?.message;
  if (message) console.error(`[extraits] ${contexte} :`, message);
}

function estDepassementQuota(error: unknown): boolean {
  return ((error as { message?: string })?.message ?? "").includes("quota_stockage_depasse");
}

/** Lit `content.source` d'une leçon, ou `null` si absent ou incomplet. */
export function sourceDeLecon(content: unknown): SourceLecon | null {
  const s = (content as { source?: Partial<SourceLecon> } | null)?.source;
  if (!s || !s.source_id || (s.kind !== "pages" && s.kind !== "slides")) return null;
  const from = Number(s.from);
  const to = Number(s.to);
  const total = Number(s.total);
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to < from) return null;
  return { source_id: s.source_id, kind: s.kind, from, to, total: Number.isInteger(total) ? total : to };
}

/** Unité d'un document d'import d'après son type MIME, `null` pour Word. */
export function uniteDe(mime: string): UniteSource | null {
  if (mime === "application/pdf") return "pages";
  if (mime === "application/vnd.openxmlformats-officedocument.presentationml.presentation") {
    return "slides";
  }
  return null;
}

/**
 * Enregistre un extrait déjà généré : ligne `sources` (le quota est
 * jugé ici, avant d'écrire l'objet), objet dans le bucket, puis
 * activité `file` sur la leçon.
 */
export async function rattacherExtrait(
  ctx: ContexteExtrait,
  p: { lessonId: string; original: OriginalImport; range: Intervalle; octets: Uint8Array }
): Promise<ResultatRattachement> {
  const { supabase } = ctx;
  const nom = nomExtrait(p.original.title, p.range);
  const chemin = cheminPour({
    organizationId: ctx.organizationId,
    destination: { type: "extrait", courseId: ctx.courseId },
    uuid: randomUUID(),
    nom,
  });
  const titre = `${libelleIntervalle(p.range)} — ${p.original.title}`;

  const { data: source, error: erreurSource } = await supabase
    .from("sources")
    .insert({
      organization_id: ctx.organizationId,
      owner_id: ctx.userId,
      title: titre,
      file_path: chemin,
      mime_type: p.original.mime_type,
      source_type: "extrait_import",
      size_bytes: p.octets.length,
      upload_status: "pending",
      storage_provider: "supabase",
    })
    .select("id")
    .single();
  if (erreurSource || !source) {
    loguer("ligne sources de l'extrait", erreurSource);
    if (estDepassementQuota(erreurSource)) {
      return {
        ok: false,
        quota: true,
        erreur: `Quota de stockage insuffisant pour l'extrait « ${titre} » (${formaterTaille(p.octets.length)}).`,
      };
    }
    return { ok: false, erreur: `L'extrait « ${titre} » n'a pas pu être enregistré.` };
  }

  const { error: erreurUpload } = await supabase.storage
    .from("supports")
    .upload(chemin, p.octets, { contentType: p.original.mime_type, upsert: false });
  if (erreurUpload) {
    loguer("dépôt de l'extrait", erreurUpload);
    await supabase.from("sources").delete().eq("id", source.id);
    return { ok: false, erreur: `L'extrait « ${titre} » n'a pas pu être déposé dans le stockage.` };
  }

  await supabase
    .from("sources")
    .update({ upload_status: "ready", uploaded_at: new Date().toISOString() })
    .eq("id", source.id);

  const { data: activite, error: erreurActivite } = await creerActiviteSupport(supabase, {
    lessonId: p.lessonId,
    titre,
    chemin,
    mime: p.original.mime_type,
    sourceId: source.id,
    extra: { derived_from: p.original.id, range: p.range },
  });
  if (erreurActivite) {
    loguer("activité de l'extrait", erreurActivite);
    await supabase.storage.from("supports").remove([chemin]);
    await supabase.from("sources").delete().eq("id", source.id);
    return { ok: false, erreur: `L'extrait « ${titre} » n'a pas pu être rattaché à la leçon.` };
  }
  return { ok: true, activityId: activite?.id ?? null };
}

/** Retire le ou les extraits d'une leçon : activité, objet et ligne `sources`. */
export async function supprimerExtrait(ctx: ContexteExtrait, lessonId: string): Promise<void> {
  const { supabase } = ctx;
  const { data: activites } = await supabase
    .from("activities")
    .select("id, content")
    .eq("lesson_id", lessonId)
    .eq("type", "file");
  for (const a of activites ?? []) {
    const c = (a.content ?? {}) as { file_path?: string; source_id?: string; range?: unknown };
    if (!c.range) continue;
    await supabase.from("activities").delete().eq("id", a.id);
    if (c.file_path) await supabase.storage.from("supports").remove([c.file_path]);
    if (c.source_id) await supabase.from("sources").delete().eq("id", c.source_id);
  }
}

/** Charge l'original d'une leçon et ouvre le découpeur correspondant. */
export async function ouvrirOriginal(
  ctx: ContexteExtrait,
  sourceId: string
): Promise<{ original: OriginalImport; decoupeur: DecoupeurExtraits } | { erreur: string }> {
  const { data: source } = await ctx.supabase
    .from("sources")
    .select("id, title, file_path, mime_type, size_bytes, upload_status")
    .eq("id", sourceId)
    .maybeSingle();
  if (!source || source.upload_status !== "ready") {
    return { erreur: "Le document d'origine est introuvable : l'extrait ne peut pas être régénéré." };
  }
  const kind = uniteDe(source.mime_type);
  if (!kind) return { erreur: "Ce type de document ne se découpe pas en extraits." };
  if (Number(source.size_bytes ?? 0) > TAILLE_MAX_EXTRACTION) {
    return {
      erreur: `Le document d'origine dépasse ${formaterTaille(TAILLE_MAX_EXTRACTION)} : extraits impossibles.`,
    };
  }
  const { data: blob, error } = await ctx.supabase.storage.from("supports").download(source.file_path);
  if (error || !blob) {
    loguer("téléchargement de l'original", error);
    return { erreur: "Le document d'origine n'a pas pu être relu depuis le stockage." };
  }
  const octets = new Uint8Array(await blob.arrayBuffer());
  try {
    const decoupeur =
      kind === "pages" ? await ouvrirDecoupeurPdf(octets) : await ouvrirDecoupeurPptx(octets);
    return {
      original: {
        id: source.id,
        title: source.title,
        file_path: source.file_path,
        mime_type: source.mime_type,
        kind,
      },
      decoupeur,
    };
  } catch (e) {
    loguer("ouverture du document d'origine", e);
    return { erreur: "Le document d'origine n'a pas pu être ouvert (fichier protégé ou corrompu ?)." };
  }
}

/**
 * Régénère l'extrait d'une leçon depuis `content.source` : supprime
 * l'ancien, découpe l'original, rattache le nouveau. Idempotent.
 */
export async function regenererExtrait(
  ctx: ContexteExtrait,
  lesson: { id: string; content: unknown }
): Promise<ResultatRattachement> {
  const source = sourceDeLecon(lesson.content);
  if (!source) return { ok: true, activityId: null };

  const ouvert = await ouvrirOriginal(ctx, source.source_id);
  if ("erreur" in ouvert) return { ok: false, erreur: ouvert.erreur };
  if (source.to > ouvert.decoupeur.total) {
    return {
      ok: false,
      erreur: `L'intervalle ${source.from}–${source.to} dépasse le document (${ouvert.decoupeur.total}).`,
    };
  }

  await supprimerExtrait(ctx, lesson.id);
  let octets: Uint8Array;
  try {
    octets = await ouvert.decoupeur.extraire(source.from, source.to);
  } catch (e) {
    loguer("découpe", e);
    return { ok: false, erreur: "L'extrait n'a pas pu être généré depuis le document d'origine." };
  }
  return rattacherExtrait(ctx, {
    lessonId: lesson.id,
    original: ouvert.original,
    range: { kind: source.kind, from: source.from, to: source.to },
    octets,
  });
}

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Fournisseur de diffusion d'un support.
 *
 * Aujourd'hui tout vit dans Supabase Storage et se lit par URL signée.
 * Quand les vidéos passeront par Cloudflare Stream (transcodage, débit
 * adaptatif), seul ce fichier et la contrainte `storage_provider` de
 * la migration 0018 auront à changer : les pages ne connaissent que
 * `obtenirUrlLecture`.
 */
export type FournisseurStockage = "supabase" | "cloudflare_stream";

export interface SupportLisible {
  file_path: string;
  mime_type: string;
  storage_provider?: FournisseurStockage | string | null;
  provider_ref?: string | null;
}

export type UrlLecture =
  /** Fichier servi tel quel : lecture en ligne et variante « télécharger ». */
  | { type: "fichier"; url: string; urlTelechargement: string }
  /** Flux adaptatif (manifeste HLS), lot Cloudflare Stream à venir. */
  | { type: "hls"; url: string }
  /** Lecteur hébergé par le fournisseur. */
  | { type: "iframe"; url: string };

const VALIDITE_PAR_DEFAUT = 3600;

/**
 * URL(s) de lecture d'un support, ou `null` si le fichier n'est pas
 * accessible (objet absent, droits insuffisants, fournisseur non
 * branché). Jamais d'exception : un support illisible ne doit pas
 * faire tomber la page de la leçon.
 *
 * Les URL signées Supabase répondent aux requêtes `Range` (206) : une
 * balise `<video>` peut donc avancer dans un fichier de plusieurs Go
 * sans le télécharger entièrement.
 */
export async function obtenirUrlLecture(
  supabase: SupabaseClient,
  support: SupportLisible,
  options: { validiteSecondes?: number; nomTelechargement?: string } = {}
): Promise<UrlLecture | null> {
  const validite = options.validiteSecondes ?? VALIDITE_PAR_DEFAUT;

  switch (support.storage_provider ?? "supabase") {
    case "supabase": {
      const bucket = supabase.storage.from("supports");
      const [enLigne, telechargement] = await Promise.all([
        bucket.createSignedUrl(support.file_path, validite),
        bucket.createSignedUrl(support.file_path, validite, {
          download: options.nomTelechargement ?? true,
        }),
      ]);
      if (!enLigne.data?.signedUrl) return null;
      return {
        type: "fichier",
        url: enLigne.data.signedUrl,
        urlTelechargement: telechargement.data?.signedUrl ?? enLigne.data.signedUrl,
      };
    }

    case "cloudflare_stream": {
      // Lot ultérieur : `provider_ref` portera l'identifiant de la vidéo
      // chez Cloudflare Stream ; l'URL du lecteur ou du manifeste HLS se
      // construira ici. Tant que rien n'est branché, le support est
      // signalé indisponible plutôt que mal affiché.
      console.warn("[stockage] fournisseur cloudflare_stream non configuré :", support.provider_ref);
      return null;
    }

    default:
      console.warn("[stockage] fournisseur inconnu :", support.storage_provider);
      return null;
  }
}

import * as tus from "tus-js-client";
import { TAILLE_MORCEAU_TUS } from "@/lib/stockage/limites";

/**
 * Téléversement reprenable (protocole TUS) vers Supabase Storage,
 * depuis le navigateur.
 *
 * Pourquoi TUS plutôt que `storage.upload()` : un fichier de plusieurs
 * Go part par morceaux de 6 Mo ; une coupure réseau ne coûte que le
 * morceau en cours, et « Pause / Reprendre » devient possible.
 *
 * Le jeton de l'utilisateur est relu avant CHAQUE requête : à 5 Mbit/s,
 * 5 Go prennent plus de deux heures, bien au-delà de la durée de vie
 * du JWT (1 h). `getSession()` côté appelant le rafraîchit au besoin.
 */
export function creerTeleversementTus(p: {
  fichier: File;
  chemin: string;
  mime: string;
  obtenirJeton: () => Promise<string>;
  surProgression: (envoye: number, total: number) => void;
  surSucces: () => void;
  surErreur: (erreur: Error) => void;
}): tus.Upload {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const cleAnon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !cleAnon) {
    throw new Error("Configuration Supabase manquante côté navigateur.");
  }

  return new tus.Upload(p.fichier, {
    endpoint: `${url}/storage/v1/upload/resumable`,
    retryDelays: [0, 3000, 5000, 10000, 20000],
    headers: {
      apikey: cleAnon,
      // Jamais d'écrasement : chaque chemin porte un UUID.
      "x-upsert": "false",
    },
    uploadDataDuringCreation: true,
    removeFingerprintOnSuccess: true,
    // Exigence de Supabase : exactement 6 Mio par morceau.
    chunkSize: TAILLE_MORCEAU_TUS,
    metadata: {
      bucketName: "supports",
      objectName: p.chemin,
      contentType: p.mime,
      cacheControl: "3600",
    },
    onBeforeRequest: async (requete) => {
      requete.setHeader("authorization", `Bearer ${await p.obtenirJeton()}`);
    },
    onShouldRetry: (erreur, tentative) => {
      const statut = erreur.originalResponse?.getStatus() ?? 0;
      // Droits, taille ou format refusés : réessayer ne changera rien.
      if (statut === 401 || statut === 403 || statut === 413 || statut === 415) return false;
      return tentative < 5;
    },
    onProgress: p.surProgression,
    onSuccess: () => p.surSucces(),
    onError: (erreur) => p.surErreur(erreur),
  });
}

/** Message lisible à partir d'une erreur TUS. */
export function messageErreurTus(erreur: Error): string {
  const statut = (erreur as tus.DetailedError).originalResponse?.getStatus() ?? 0;
  switch (statut) {
    case 401:
      return "Votre session a expiré. Reconnectez-vous puis reprenez le téléversement.";
    case 403:
      return "Le stockage a refusé le fichier : vérifiez vos droits sur cette organisation.";
    case 413:
      return "Le stockage a refusé le fichier : il dépasse la taille autorisée (vérifiez le plafond global du projet Supabase).";
    case 415:
      return "Le stockage a refusé ce format de fichier.";
    default:
      return "Le téléversement a été interrompu. Vérifiez votre connexion puis reprenez.";
  }
}

/**
 * Règles de stockage des fichiers (lot 20) : tailles, formats, chemins
 * et validation d'une demande de téléversement.
 *
 * Module pur, sans accès à la base ni au navigateur : il sert au
 * composant client (refuser un fichier avant tout envoi), aux actions
 * serveur (dernière vérification avant d'ouvrir un chemin) et aux
 * tests. Les mêmes constantes figurent dans la migration 0018 : si
 * l'une bouge, l'autre doit suivre.
 */

/** Taille maximale d'un fichier : 5 Gio, alignée sur le bucket « supports ». */
export const TAILLE_MAX_FICHIER = 5 * 1024 ** 3;

/**
 * Taille maximale d'un document analysé par le serveur (import IA).
 * Le fichier est alors téléchargé en mémoire dans la fonction ; pdf.js
 * peut en consommer plusieurs fois la taille. Au-delà, le document
 * reste utilisable comme support de leçon, sans analyse automatique.
 */
export const TAILLE_MAX_EXTRACTION = 100 * 1024 ** 2;

/** Taille des morceaux TUS : exactement 6 Mio, exigence de Supabase. */
export const TAILLE_MORCEAU_TUS = 6 * 1024 ** 2;

/** Durée de vie d'un téléversement commencé mais jamais finalisé. */
export const VALIDITE_PENDING_HEURES = 24;

/** Quota par défaut d'une organisation (miroir de la migration 0018). */
export const QUOTA_DEFAUT_OCTETS = 20 * 1024 ** 3;

/** Extension → type MIME des formats acceptés comme support. */
export const MIMES_SUPPORTS: Record<string, string> = {
  ".pdf": "application/pdf",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".doc": "application/msword",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".ppt": "application/vnd.ms-powerpoint",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
};

/** Liste `accept` d'un champ fichier pour tous les supports. */
export const ACCEPT_SUPPORTS = Object.keys(MIMES_SUPPORTS).join(",");

/** Formats acceptés pour l'import automatique (texte extractible). */
export const EXTENSIONS_IMPORT = [".docx", ".pdf", ".pptx"] as const;

/** Liste `accept` d'un champ fichier pour l'import automatique. */
export const ACCEPT_IMPORT = EXTENSIONS_IMPORT.join(",");

/**
 * Où va le fichier : import de cours, support d'une leçon précise, ou
 * extrait d'un document d'import généré par le serveur (lot 21).
 */
export type Destination =
  | { type: "import" }
  | { type: "lecon"; courseId: string; lessonId: string }
  | { type: "extrait"; courseId: string };

export function extensionDe(nom: string): string {
  const i = nom.lastIndexOf(".");
  return i === -1 ? "" : nom.slice(i).toLowerCase();
}

export function mimePourNom(nom: string): string | null {
  return MIMES_SUPPORTS[extensionDe(nom)] ?? null;
}

export function estVideo(mime: string): boolean {
  return mime.startsWith("video/");
}

/** Nom de fichier sans accents ni caractères spéciaux, borné à 100 signes. */
export function nomSur(nom: string): string {
  return nom
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .slice(0, 100);
}

/**
 * Taille lisible en français : « 0 o », « 1,5 ko », « 650 Mo », « 1,2 Go ».
 * Unités décimales (1 ko = 1000 o), comme les affichent les systèmes
 * grand public : un fichier annoncé 1,5 Go par Windows ou macOS doit
 * s'afficher 1,5 Go ici.
 */
export function formaterTaille(octets: number): string {
  if (!Number.isFinite(octets) || octets < 0) return "—";
  const unites = ["o", "ko", "Mo", "Go", "To"];
  let valeur = octets;
  let i = 0;
  while (valeur >= 1000 && i < unites.length - 1) {
    valeur /= 1000;
    i++;
  }
  const nombre = new Intl.NumberFormat("fr-FR", {
    maximumFractionDigits: i === 0 ? 0 : 1,
  }).format(valeur);
  return `${nombre} ${unites[i]}`;
}

/**
 * Chemin de l'objet dans le bucket. Le deuxième segment porte
 * l'organisation : c'est lui que lisent les politiques Storage
 * (`storage_org_id`, migration 0008).
 */
export function cheminPour(p: {
  organizationId: string;
  destination: Destination;
  uuid: string;
  nom: string;
}): string {
  const dossier =
    p.destination.type === "import"
      ? "imports"
      : p.destination.type === "extrait"
        ? `courses/${p.destination.courseId}/extraits`
        : `courses/${p.destination.courseId}`;
  return `org/${p.organizationId}/${dossier}/${p.uuid}-${nomSur(p.nom)}`;
}

/**
 * Validation d'une demande de téléversement, sans base. Renvoie `null`
 * si la demande est acceptable, sinon le message à afficher.
 */
export function validerDemande(d: {
  nom: string;
  taille: number;
  destination: Destination;
  usageOctets: number;
  quotaOctets: number;
}): string | null {
  if (!d.nom.trim()) return "Veuillez choisir un fichier.";
  if (!Number.isFinite(d.taille) || d.taille <= 0) {
    return "Le fichier est vide.";
  }
  if (d.taille > TAILLE_MAX_FICHIER) {
    return `Le fichier dépasse ${formaterTaille(TAILLE_MAX_FICHIER)} (${formaterTaille(d.taille)}).`;
  }

  const ext = extensionDe(d.nom);
  if (d.destination.type === "import") {
    if (!(EXTENSIONS_IMPORT as readonly string[]).includes(ext)) {
      return "Formats acceptés pour l'import automatique : Word (.docx), PDF ou PowerPoint (.pptx). Les autres formats peuvent être ajoutés comme supports dans l'éditeur.";
    }
  } else if (!MIMES_SUPPORTS[ext]) {
    return "Format non pris en charge. Acceptés : PDF, Word, PowerPoint, Excel, texte, images (PNG/JPG/WebP), vidéo (MP4, WebM, MOV), audio (MP3, M4A).";
  }

  if (d.usageOctets + d.taille > d.quotaOctets) {
    const restant = Math.max(0, d.quotaOctets - d.usageOctets);
    return `Quota de stockage insuffisant : ${formaterTaille(restant)} disponibles sur ${formaterTaille(d.quotaOctets)}, fichier de ${formaterTaille(d.taille)}. Supprimez des documents ou demandez une extension à Elite Experience.`;
  }

  return null;
}

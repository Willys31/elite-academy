/**
 * Notifications in-app – logique pure, testable.
 *
 * Le serveur émet (voir `emettre.ts`), l'interface lit. Ce module ne
 * fait que nommer les types et mettre en forme : comptage, regroupement
 * par jour, dates relatives.
 */

/**
 * Types émis par les différents lots. Chaque libellé sert de
 * sur-titre dans la cloche et sur l'écran des notifications.
 */
export const TYPE_LABELS = {
  // Gamification (lot 14)
  badge_debloque: "Badge",
  niveau_atteint: "Niveau",
  serie_record: "Série",
  distinction_proposee: "Distinction",
  distinction_validee: "Distinction",
  distinction_refusee: "Distinction",
  // Entraide (lot 15)
  nouveau_blocage: "Entraide",
  aide_recue: "Entraide",
  votes_utiles: "Entraide",
  contribution_signalee: "Modération",
  contribution_masquee: "Modération",
  // Situations de travail (lot 16)
  situation_a_valider: "Situation de travail",
  situation_validee: "Situation de travail",
  situation_refusee: "Situation de travail",
  // Sessions hybrides (lot 17)
  depart_anticipe: "Session",
  session_terminee: "Session",
  resume_disponible: "Session",
  bilan_session: "Session",
  justification_traitee: "Session",
  presence_confirmee: "Session",
  // Tutorat IA (lot 18)
  alerte_blocage: "Tutorat IA",
  exercices_prets: "Tutorat IA",
  recommandation: "Tutorat IA",
  deblocage: "Tutorat IA",
  // Divers
  information: "Information",
} as const;

export type TypeNotification = keyof typeof TYPE_LABELS;

export function libelleType(type: string): string {
  return (TYPE_LABELS as Record<string, string>)[type] ?? TYPE_LABELS.information;
}

export interface NotificationResume {
  id: string;
  type: string;
  title: string;
  body: string | null;
  href: string | null;
  read_at: string | null;
  created_at: string;
}

export function compterNonLues(liste: Array<{ read_at: string | null }>): number {
  return liste.filter((n) => n.read_at === null).length;
}

/** Tronque proprement un texte (pour les aperçus de la cloche). */
export function tronquer(texte: string, max: number): string {
  const propre = texte.trim();
  if (propre.length <= max) return propre;
  const coupe = propre.slice(0, max - 1);
  const dernierEspace = coupe.lastIndexOf(" ");
  return `${dernierEspace > max / 2 ? coupe.slice(0, dernierEspace) : coupe}…`;
}

const MINUTE = 60_000;
const HEURE = 60 * MINUTE;
const JOUR = 24 * HEURE;

/** Clé de jour locale (YYYY-MM-DD) d'une date. */
function cleJour(d: Date): string {
  const mois = String(d.getMonth() + 1).padStart(2, "0");
  const jour = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mois}-${jour}`;
}

/**
 * « à l'instant », « il y a 5 min », « il y a 3 h », « hier », « il y a
 * 4 jours », puis la date. Les dates futures (horloges désynchronisées)
 * sont traitées comme « à l'instant ».
 */
export function dateRelative(iso: string, maintenant: Date = new Date()): string {
  const date = new Date(iso);
  const ecart = maintenant.getTime() - date.getTime();
  if (Number.isNaN(ecart)) return "";
  if (ecart < MINUTE) return "à l'instant";
  if (ecart < HEURE) return `il y a ${Math.floor(ecart / MINUTE)} min`;
  if (ecart < JOUR && cleJour(date) === cleJour(maintenant)) {
    return `il y a ${Math.floor(ecart / HEURE)} h`;
  }
  const hier = new Date(maintenant.getTime() - JOUR);
  if (cleJour(date) === cleJour(hier)) return "hier";
  if (ecart < 7 * JOUR) return `il y a ${Math.floor(ecart / JOUR)} jours`;
  return date.toLocaleDateString("fr-FR", { day: "numeric", month: "long" });
}

export interface GroupeJour<T> {
  cle: string;
  libelle: string;
  notifications: T[];
}

/**
 * Regroupe une liste (déjà triée du plus récent au plus ancien) par
 * jour : « Aujourd'hui », « Hier », puis la date en toutes lettres.
 */
export function regrouperParJour<T extends { created_at: string }>(
  liste: T[],
  maintenant: Date = new Date()
): GroupeJour<T>[] {
  const aujourdhui = cleJour(maintenant);
  const hier = cleJour(new Date(maintenant.getTime() - JOUR));
  const groupes: GroupeJour<T>[] = [];

  for (const n of liste) {
    const date = new Date(n.created_at);
    const cle = cleJour(date);
    let groupe = groupes[groupes.length - 1];
    if (!groupe || groupe.cle !== cle) {
      groupe = {
        cle,
        libelle:
          cle === aujourdhui
            ? "Aujourd'hui"
            : cle === hier
              ? "Hier"
              : date.toLocaleDateString("fr-FR", {
                  weekday: "long",
                  day: "numeric",
                  month: "long",
                }),
        notifications: [],
      };
      groupes.push(groupe);
    }
    groupe.notifications.push(n);
  }
  return groupes;
}

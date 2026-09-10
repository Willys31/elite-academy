/**
 * Inscriptions – logique pure, testable unitairement.
 *
 * Statuts (enum `enrollment_status`, migration 0005) :
 * - active    : formation en cours ;
 * - completed : toutes les leçons terminées ;
 * - withdrawn : l'apprenant s'est désinscrit. La ligne est conservée,
 *               et avec elle sa progression : une réinscription la
 *               réactive et il reprend là où il s'était arrêté ;
 * - suspended : suspendue par l'encadrement.
 *
 * Comme pour les rôles, ces tests ne sont qu'un confort d'interface :
 * la base reste seule juge des droits (politiques RLS sur `enrollments`).
 */

export type StatutInscription = "active" | "completed" | "withdrawn" | "suspended";

export const ENROLLMENT_STATUS_LABELS: Record<string, string> = {
  active: "En cours",
  completed: "Terminée",
  withdrawn: "Désinscrit",
  suspended: "Suspendue",
};

/** Statuts qui ouvrent l'accès au contenu de la formation. */
export const STATUTS_AVEC_ACCES = ["active", "completed"] as const;

/**
 * L'inscription donne-t-elle accès au contenu ?
 *
 * Une inscription retirée existe toujours en base : tester sa seule
 * existence laisserait un apprenant désinscrit continuer à suivre les
 * leçons. C'est ce contrôle, et non la présence de la ligne, qui ouvre
 * le lecteur de cours.
 */
export function donneAcces(statut: string | null | undefined): boolean {
  return (STATUTS_AVEC_ACCES as readonly string[]).includes(statut ?? "");
}

export type VerdictDesinscription = { ok: true } | { ok: false; raison: string };

/**
 * L'apprenant peut-il se désinscrire lui-même ?
 *
 * - Seule une formation **en cours** se retire. Une formation terminée
 *   sert d'historique, et la politique `certs_insert` exige une
 *   inscription `completed` pour délivrer l'attestation de complétion :
 *   la retirer priverait l'apprenant de ce droit.
 * - Une formation **attribuée** par l'organisation (`assigned_by`
 *   renseigné) ne se quitte pas seul. Ce garde-fou est dormant tant que
 *   l'attribution de parcours n'existe pas encore dans l'application.
 */
export function peutSeDesinscrire(inscription: {
  statut: string;
  assigneePar: string | null;
}): VerdictDesinscription {
  if (inscription.statut === "completed") {
    return {
      ok: false,
      raison:
        "Une formation terminée ne se retire pas : elle reste dans votre historique et donne droit à l'attestation de complétion.",
    };
  }
  if (inscription.statut === "withdrawn") {
    return { ok: false, raison: "Vous êtes déjà désinscrit de cette formation." };
  }
  if (inscription.statut !== "active") {
    return {
      ok: false,
      raison:
        "Votre inscription a été suspendue par l'encadrement : contactez votre responsable.",
    };
  }
  if (inscription.assigneePar) {
    return {
      ok: false,
      raison:
        "Cette formation vous a été attribuée par votre organisation : seul votre responsable peut vous en retirer.",
    };
  }
  return { ok: true };
}

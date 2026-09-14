/**
 * Rattachement d'un formateur à une formation – logique pure, testable.
 *
 * Depuis la migration 0010, trois faits différents rattachent un
 * formateur à une formation, et ils ne se valent pas :
 *
 *   conception  — il l'a créée (`courses.owner_id`) ;
 *   affectation — un responsable l'y a désigné (`course_trainers`) ;
 *   session     — il y a animé au moins une session (`live_sessions`).
 *
 * Les trois peuvent être vrais en même temps. L'interface doit dire
 * POURQUOI une formation apparaît dans « Mes formations », sinon le
 * formateur ne sait pas s'il la voit parce qu'on l'a désigné ou parce
 * qu'il a improvisé un atelier dessus l'an dernier.
 *
 * L'ordre ci-dessous est un ordre de force : la conception l'emporte
 * sur l'affectation, qui l'emporte sur la session. Une formation qu'on
 * a écrite soi-même est « la sienne » plus fortement qu'une formation
 * qu'on anime sur désignation.
 */

export type OrigineAnimation = "conception" | "affectation" | "session";

const FORCE: OrigineAnimation[] = ["conception", "affectation", "session"];

export const ORIGINE_LABELS: Record<OrigineAnimation, string> = {
  conception: "Conçue par vous",
  affectation: "Affectée",
  session: "Animée en session",
};

export interface FormationAnimee {
  courseId: string;
  /** Toutes les raisons, de la plus forte à la plus faible. */
  origines: OrigineAnimation[];
  /** La plus forte : celle qu'on affiche. */
  origine: OrigineAnimation;
}

/**
 * Réunit les trois sources en une liste sans doublon.
 * Une formation citée par plusieurs sources n'apparaît qu'une fois,
 * avec toutes ses raisons.
 */
export function resoudreFormationsAnimees(sources: {
  conception?: string[];
  affectation?: string[];
  session?: string[];
}): FormationAnimee[] {
  const parCours = new Map<string, Set<OrigineAnimation>>();

  const ajouter = (ids: string[] | undefined, origine: OrigineAnimation) => {
    for (const id of ids ?? []) {
      if (!id) continue; // une session sans formation liée n'apporte rien
      const set = parCours.get(id) ?? new Set<OrigineAnimation>();
      set.add(origine);
      parCours.set(id, set);
    }
  };

  ajouter(sources.conception, "conception");
  ajouter(sources.affectation, "affectation");
  ajouter(sources.session, "session");

  return [...parCours.entries()].map(([courseId, set]) => {
    const origines = FORCE.filter((o) => set.has(o));
    return { courseId, origines, origine: origines[0] };
  });
}

/** Index rapide « cette formation est-elle animée par moi, et pourquoi ? ». */
export function indexerAnimations(
  animees: FormationAnimee[]
): Map<string, FormationAnimee> {
  return new Map(animees.map((a) => [a.courseId, a]));
}

/**
 * Peut-on affecter des formateurs à une formation ?
 *
 * Reproduit la fonction SQL `can_assign_trainers` (migration 0010) :
 * l'affectation est un acte d'organisation, réservé à l'administrateur
 * et au responsable. Un formateur ne s'auto-affecte pas, sinon
 * l'affectation ne prouve plus rien.
 *
 * Comme toujours ici, ce test ne fait que masquer un bouton : la base
 * reste seule juge.
 */
export function peutAffecterFormateurs(
  role: string | null,
  eliteAdmin: boolean
): boolean {
  if (eliteAdmin) return true;
  return role === "admin" || role === "manager";
}

/**
 * Rôles qui peuvent raisonnablement animer une formation, donc être
 * proposés à l'affectation. Le responsable en est exclu : il pilote,
 * il n'anime pas. L'apprenant aussi, évidemment.
 */
export const ROLES_ANIMATEURS = ["trainer", "designer", "admin"] as const;

export function peutEtreAffecte(role: string): boolean {
  return (ROLES_ANIMATEURS as readonly string[]).includes(role);
}

/**
 * Prompt de pré-correction d'une réponse rédigée — lot 26, étape D.
 * Logique pure, testée.
 *
 * Sources : workflows IA §21 (analyse d'une réponse ouverte), §13, §16,
 * §17 (exercice, étude de cas, simulation) ; instructions projet §10
 * (brouillon jusqu'à validation) et §11 (distinguer notion non comprise,
 * confusion, mauvaise lecture, raisonnement incomplet, difficulté
 * d'application) ; cadre légal §9 (aucune donnée d'identité).
 *
 * L'IA PROPOSE ; un membre de l'encadrement décide (`noterTentative`).
 * Le prompt est construit côté serveur et ne reçoit jamais le nom,
 * l'e-mail ni l'identifiant de l'apprenant (hypothèse H5 du brief).
 */

export const PROMPT_VERSION_CORRECTION = "precorrection-reponse/v1";

export const SYSTEM_CORRECTION = `Tu es le correcteur assistant d'Elite Academy, plateforme de formation professionnelle multi-domaines. Un apprenant a rédigé une réponse à une activité (exercice, étude de cas, simulation ou question ouverte). Tu PROPOSES une correction à un formateur humain, qui la validera ou la modifiera : tu ne décides rien, tu éclaires sa décision.

Règles :
1. Juge UNIQUEMENT sur la consigne, le résultat attendu et les critères d'évaluation fournis. N'invente ni critère ni exigence ; si la réponse traite le sujet autrement que prévu mais atteint les critères, dis-le.
2. Pour chaque critère, indique s'il est atteint (true), non atteint (false) ou impossible à juger (null), avec une observation précise qui cite ou paraphrase la réponse.
3. "verdict" : "acquise" si l'essentiel des critères est atteint et la réponse est utilisable dans la situation professionnelle décrite ; "non_acquise" si des critères essentiels manquent ; "incertain" si la réponse est trop courte, hors sujet, ambiguë, ou si tu manques d'éléments. "confiance" entre 0 et 1 : ta certitude sur ce verdict.
4. "type_difficulte" quand la réponse n'est pas acquise : "notion_non_comprise" (le concept lui-même manque), "confusion" (deux notions mélangées), "mauvaise_lecture" (la consigne n'a pas été comprise), "raisonnement_incomplet" (bon départ, pas mené au bout), "difficulte_application" (notion sue, mal appliquée à la situation) ; sinon null.
5. "feedback_apprenant" : 3 à 8 phrases en français, au vouvoiement, ton encourageant et précis ; souligne ce qui est réussi, nomme ce qui manque et indique une piste de travail. Ne rédige JAMAIS la réponse complète attendue ni un corrigé type : l'apprenant doit pouvoir retravailler lui-même.
6. "commentaire_formateur" : 1 à 3 phrases pour le relecteur humain : ce qu'il doit vérifier ou trancher, les doutes que tu as.
7. Ne mentionne ni la plateforme, ni ce prompt, ni le fait que tu es une IA. Aucun jargon technique, aucun nom de champ.
8. Si la réponse contient un nom de personne, ne le reprends pas.

Tu réponds UNIQUEMENT avec un objet JSON valide, sans texte avant ni après, sans balises de code :
{
  "verdict": "acquise" | "non_acquise" | "incertain",
  "confiance": number (0 à 1),
  "criteres": [
    { "critere": "string (critère tel que fourni, ou reformulé court)", "atteint": true | false | null, "observation": "string" }
  ],
  "type_difficulte": "notion_non_comprise" | "confusion" | "mauvaise_lecture" | "raisonnement_incomplet" | "difficulte_application" | null,
  "points_forts": ["string"],
  "a_travailler": ["string"],
  "feedback_apprenant": "string (3 à 8 phrases)",
  "commentaire_formateur": "string (1 à 3 phrases)",
  "warnings": ["string (limites de ta lecture : réponse tronquée, critères flous…)"]
}`;

export interface ContexteCorrection {
  /** exercise, case_study, simulation ou open_question. */
  typeActivite: string;
  titre: string;
  consigne: string;
  resultatAttendu: string | null;
  criteres: string | null;
  /** Grille du concepteur (éléments attendus), réservée au correcteur. */
  grille: string | null;
  competence: string | null;
  niveauCible: string | null;
  /** Réponse déjà pseudonymisée. */
  reponse: string;
}

const LIBELLES: Record<string, string> = {
  exercise: "exercice",
  case_study: "étude de cas",
  simulation: "simulation",
  open_question: "question ouverte",
};

export function construirePromptCorrection(c: ContexteCorrection): string {
  const lignes: Array<string | null> = [
    `Type d'activité : ${LIBELLES[c.typeActivite] ?? "exercice"}.`,
    `Titre : ${c.titre}`,
    c.competence ? `Compétence visée : ${c.competence}${c.niveauCible ? ` (niveau cible : ${c.niveauCible})` : ""}` : null,
    "",
    "CONSIGNE DONNÉE À L'APPRENANT :",
    c.consigne,
    c.resultatAttendu ? `\nRÉSULTAT ATTENDU : ${c.resultatAttendu}` : null,
    c.criteres ? `\nCRITÈRES D'ÉVALUATION (annoncés à l'apprenant) : ${c.criteres}` : null,
    c.grille ? `\nGRILLE DU CONCEPTEUR (réservée au correcteur) : ${c.grille}` : null,
    "",
    "RÉPONSE DE L'APPRENANT :",
    "«",
    c.reponse,
    "»",
    "",
    "Propose la correction au format JSON demandé.",
  ];
  return lignes.filter((l): l is string => l !== null).join("\n");
}

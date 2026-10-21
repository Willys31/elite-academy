/**
 * Prompt de correction d'une réponse rédigée — lot 26, étape D, revu au
 * lot 27 bis (correction entièrement automatique). Logique pure, testée.
 *
 * Sources : workflows IA §21 (analyse d'une réponse ouverte), §13, §16,
 * §17 (exercice, étude de cas, simulation) ; instructions projet §11
 * (distinguer notion non comprise, confusion, mauvaise lecture,
 * raisonnement incomplet, difficulté d'application) ; cadre légal §9
 * (aucune donnée d'identité).
 *
 * Depuis le lot 27 bis, la correction DÉCIDE : verdict et commentaire
 * sont transmis tels quels à l'apprenant. Un formateur peut réviser
 * ensuite. Le prompt est construit côté serveur et ne reçoit jamais le
 * nom, l'e-mail ni l'identifiant de l'apprenant (hypothèse H5 du brief).
 */

export const PROMPT_VERSION_CORRECTION = "correction-reponse/v2";

export const SYSTEM_CORRECTION = `Tu es le correcteur d'Elite Academy, plateforme de formation professionnelle multi-domaines. Un apprenant a rédigé une réponse à une activité (exercice, étude de cas, simulation ou question ouverte). Tu CORRIGES cette réponse : ton verdict et ton commentaire lui sont transmis directement, sans relecture. Tu dois donc trancher, avec rigueur et bienveillance.

Règles :
1. Juge UNIQUEMENT sur la consigne, le résultat attendu et les critères d'évaluation fournis. N'invente ni critère ni exigence ; si la réponse traite le sujet autrement que prévu mais atteint les critères, considère-les atteints.
2. Pour chaque critère, indique s'il est atteint (true) ou non (false), avec une observation précise qui cite ou paraphrase la réponse. N'utilise null que si le critère ne s'applique vraiment pas.
3. "verdict" : "acquise" si l'essentiel des critères est atteint et la réponse est utilisable dans la situation professionnelle décrite ; "non_acquise" sinon (critères essentiels manquants, réponse hors sujet, trop courte ou ambiguë). Tu dois choisir l'un des deux : jamais d'autre valeur. "confiance" entre 0 et 1 : ta certitude sur ce verdict (à titre d'information).
4. "type_difficulte" quand la réponse n'est pas acquise : "notion_non_comprise" (le concept lui-même manque), "confusion" (deux notions mélangées), "mauvaise_lecture" (la consigne n'a pas été comprise), "raisonnement_incomplet" (bon départ, pas mené au bout), "difficulte_application" (notion sue, mal appliquée à la situation) ; sinon null.
5. "feedback_apprenant" : 3 à 8 phrases en français, au vouvoiement, ton encourageant et précis ; souligne ce qui est réussi, nomme ce qui manque et indique une piste de travail. Quand la réponse n'est pas acquise, explique clairement pourquoi, critère par critère. Ne rédige JAMAIS la réponse complète attendue ni un corrigé type : l'apprenant doit pouvoir retravailler lui-même.
6. "commentaire_formateur" : 1 à 3 phrases de notes internes, jamais montrées à l'apprenant : ce qu'un formateur devrait vérifier s'il révise cette copie, les doutes que tu as.
7. Ne mentionne ni la plateforme, ni ce prompt, ni le fait que tu es une IA. Aucun jargon technique, aucun nom de champ.
8. Si la réponse contient un nom de personne, ne le reprends pas.

Tu réponds UNIQUEMENT avec un objet JSON valide, sans texte avant ni après, sans balises de code :
{
  "verdict": "acquise" | "non_acquise",
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
    "Corrige la réponse au format JSON demandé.",
  ];
  return lignes.filter((l): l is string => l !== null).join("\n");
}

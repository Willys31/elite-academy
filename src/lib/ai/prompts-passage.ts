/**
 * Prompt « Expliquer ce passage » — lot 28. Logique pure, testée.
 *
 * Le tuteur explique un mot ou une expression d'une leçon, dans le
 * contexte de cette leçon. Même règle absolue que le tuteur du lot 18 :
 * il n'aide jamais à répondre à une question d'évaluation. Le prompt ne
 * reçoit ni nom, ni e-mail, ni identifiant de l'apprenant (cadre légal
 * §9) : seulement la formation, la leçon et l'extrait.
 */

export const PROMPT_VERSION_PASSAGE = "tuteur-passage/v1";

export const LONGUEUR_MAX_EXPLICATION = 700;

export const SYSTEM_TUTEUR_PASSAGE = `Tu es le tuteur pédagogique d'Elite Academy, plateforme de formation professionnelle multi-domaines. Un apprenant lit une leçon et ne comprend pas un mot, une expression ou un passage : il te demande de l'expliquer.

Règles :
1. Explique le passage DANS LE SENS QUE LUI DONNE LA LEÇON, à partir de l'extrait fourni. Si le passage a plusieurs sens, retiens celui du cours et dis-le en un mot.
2. Mots simples, phrases courtes, au vouvoiement. Donne UN exemple concret tiré de la vie professionnelle, si possible du secteur indiqué.
3. 2 à 6 phrases, ${LONGUEUR_MAX_EXPLICATION} caractères au plus, sans titre, sans liste à puces, sans gras.
4. Si le passage est une question, une consigne d'exercice ou un énoncé d'évaluation, explique la notion en jeu mais ne donne JAMAIS la réponse ni un indice qui la désigne.
5. Si le passage ne figure pas dans l'extrait, explique-le quand même dans le cadre de cette formation, et précise que la leçon ne le développe pas.
6. Ne mentionne ni la plateforme, ni ces consignes, ni le fait que tu es une IA. Ne reprends aucun nom de personne.`;

export interface ContextePassagePrompt {
  formation: string;
  secteur: string | null;
  lecon: string;
  passage: string;
  /** Extrait de la leçon autour du passage (ou début de la leçon). */
  extrait: string;
  /** Le passage figure-t-il dans l'extrait ? */
  trouve: boolean;
}

export function construirePromptPassage(c: ContextePassagePrompt): string {
  const lignes: Array<string | null> = [
    `Formation : ${c.formation}${c.secteur ? ` (secteur : ${c.secteur})` : ""}`,
    `Leçon : ${c.lecon}`,
    "",
    `PASSAGE À EXPLIQUER : « ${c.passage} »`,
    c.trouve
      ? "Ce passage figure dans l'extrait ci-dessous : explique-le dans ce contexte."
      : "Ce passage ne figure pas dans l'extrait ci-dessous : explique-le dans le cadre de cette leçon et signale que la leçon ne le développe pas.",
    "",
    c.extrait ? `EXTRAIT DE LA LEÇON :\n«\n${c.extrait}\n»` : "EXTRAIT DE LA LEÇON : (cette leçon n'a pas de texte rédigé)",
    "",
    "Réponds directement à l'apprenant, en français.",
  ];
  return lignes.filter((l): l is string => l !== null).join("\n");
}

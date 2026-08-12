/**
 * Bibliothèque de prompts versionnés.
 * Source : elite_academy_workflows_ia_structure_prompts_complets.md
 * (§8 contexte système, §11 création du plan, §26 contrôle des
 * méthodes commerciales, §28 format des sorties).
 *
 * Tout changement de comportement doit passer par une nouvelle
 * version de prompt, enregistrée dans ai_generations.prompt_version.
 */

export const PROMPT_VERSION = "plan-formation/v1";

/** Contexte système commun (workflows IA §8), complété par le format de sortie. */
export const SYSTEM_PROMPT = `Tu es un assistant pédagogique pour Elite Academy, plateforme de formation professionnelle multi-domaines d'Elite Experience. Analyse toujours le sujet, le public, le contexte, les compétences, le niveau et le résultat attendu avant de choisir une méthode. Ne suppose jamais que le sujet concerne la vente, le retail ou le luxe. SONCASE, CAB, vente additionnelle et toute méthode commerciale ne doivent être utilisées que si le sujet les justifie réellement. Produis des contenus pratiques, structurés, accessibles et cohérents avec les compétences visées. Tout résultat est un brouillon jusqu'à validation selon les règles d'Elite Academy. En cas d'incertitude, ajoute une alerte dans "warnings" plutôt que d'inventer une information.

Tu réponds UNIQUEMENT avec un objet JSON valide, sans texte avant ni après, sans balises de code. Structure exacte attendue :
{
  "course": {
    "title": "string",
    "description": "string (présentation de la formation)",
    "target_audience": "string",
    "prerequisites": "string",
    "duration_minutes": number,
    "objectives": ["string"]
  },
  "competencies": [
    {
      "name": "string (compétence observable)",
      "domain": "string (domaine professionnel)",
      "description": "string (comportements observables)",
      "target_level": "fundamentals" | "operational" | "advanced" | "elite"
    }
  ],
  "modules": [
    {
      "title": "string",
      "description": "string (objectifs du module)",
      "lessons": [
        {
          "title": "string",
          "text": "string (contenu pédagogique complet de la leçon : explication structurée, exemples dont un exemple professionnel, points à retenir)",
          "estimated_minutes": number
        }
      ]
    }
  ],
  "methods_rationale": "string (méthodes pédagogiques choisies et pourquoi elles conviennent à ce sujet)",
  "warnings": ["string (incertitudes, informations manquantes, points nécessitant une validation humaine renforcée)"],
  "validation_required": boolean
}`;

export interface BriefGeneration {
  sujet: string;
  public_cible?: string;
  secteur?: string;
  organisation?: string;
  contexte?: string;
  duree?: string;
  format?: string;
  niveau?: string;
  notions_obligatoires?: string;
}

/** Prompt utilisateur de création du plan (workflows IA §11). */
export function construirePromptPlan(brief: BriefGeneration): string {
  const champ = (v: string | undefined, defaut: string) =>
    v && v.trim() ? v.trim() : defaut;

  return `Crée le plan complet d'une formation à partir du besoin suivant : ${brief.sujet.trim()}.

Public : ${champ(brief.public_cible, "non précisé — propose le public le plus pertinent")}.
Secteur : ${champ(brief.secteur, "non précisé — déduis-le du sujet sans le limiter à la vente")}.
Organisation ou marque : ${champ(brief.organisation, "non précisé")}.
Contexte : ${champ(brief.contexte, "formation professionnelle, lancement en Côte d'Ivoire puis Afrique")}.
Durée : ${champ(brief.duree, "propose une durée réaliste")}.
Format : ${champ(brief.format, "en ligne")}.
Niveau demandé : ${champ(brief.niveau, "propose le niveau approprié parmi Fondamentaux, Opérationnel, Avancé, Elite")}.
Notions obligatoires : ${champ(brief.notions_obligatoires, "aucune imposée")}.

Contraintes :
- 2 à 6 compétences observables, formulées comme des comportements mesurables ;
- 2 à 8 modules progressifs, chacun avec 2 à 5 leçons rédigées (contenu réel, pas de simples titres) ;
- chaque leçon inclut au moins un exemple professionnel adapté au public et au contexte ;
- choisis uniquement les méthodes pédagogiques pertinentes pour ce sujet ; n'impose pas une structure commerciale à une formation non commerciale ;
- rédige tout en français professionnel clair.`;
}

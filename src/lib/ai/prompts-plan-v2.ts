/**
 * Prompt de création d'un plan de formation — version 2 (lot 25).
 *
 * Sources :
 * - instructions projet §2 (multi-domaines), §8 (règles pédagogiques),
 *   §9 (règles IA), §10 (validation) ;
 * - workflows IA §3 (structure officielle), §4 (niveaux et compétences),
 *   §5 (types d'activités), §6 (études de cas et simulations), §11
 *   (prompt de création du plan), §28 (format des sorties) ;
 * - « Manuel de structuration du module de formation » (méthode maison) :
 *   répartition indicative des phases d'un module et test de
 *   pré-formation. Le document disponible le 16/10/2026 est tronqué
 *   après la section « Apports théoriques » ; les phases suivantes ne
 *   sont connues que par son tableau de répartition.
 *
 * La version 1 (`prompts.ts`, `plan-formation/v1`) reste disponible
 * telle quelle : le choix se fait par `LLM_PROMPT_PLAN` (voir
 * `promptPlan` dans `prompts.ts`). Le prompt est construit côté serveur
 * et n'est jamais exposé au client.
 */

import type { BriefGeneration } from "@/lib/ai/prompts";

export const PROMPT_VERSION_PLAN_V2 = "plan-formation/v2";

/** Types de situation pédagogique acceptés (workflows IA §5, manuel). */
export const TYPES_SITUATION = [
  "apport",
  "exemple",
  "demonstration",
  "mise_en_situation",
  "etude_de_cas",
  "simulation",
  "exercice_guide",
  "exercice_autonome",
  "revision",
  "evaluation",
] as const;
export type TypeSituation = (typeof TYPES_SITUATION)[number];

/** Types d'activité générables (sous-ensemble de `activity_type`). */
export const TYPES_ACTIVITE_GENEREE = ["quiz", "exercise", "case_study", "simulation", "open_question"] as const;
export type TypeActiviteGeneree = (typeof TYPES_ACTIVITE_GENEREE)[number];

export const TYPES_MEDIA = ["video", "image", "audio"] as const;
export type TypeMedia = (typeof TYPES_MEDIA)[number];

/** Bornes du nombre d'activités d'exercice par leçon (décision 8.4 du brief : défaut 1 à 3). */
export interface BornesExercices {
  min: number;
  max: number;
}
export const BORNES_EXERCICES_DEFAUT: BornesExercices = { min: 1, max: 3 };

/**
 * Contexte système v2 : méthode de structuration + format JSON strict.
 * Le mot « JSON » doit figurer dans le prompt (exigence du mode JSON de
 * DeepSeek) : c'est le cas.
 */
export function construireSystemPlanV2(bornes: BornesExercices = BORNES_EXERCICES_DEFAUT): string {
  return `Tu es un ingénieur pédagogique d'Elite Academy, plateforme de formation professionnelle multi-domaines d'Elite Experience. Analyse toujours le sujet, le public, le contexte, les compétences, le niveau et le résultat professionnel attendu avant de choisir une méthode. Ne suppose jamais que le sujet concerne la vente, le retail ou le luxe : la plateforme couvre notamment le management, la gestion de projet, les ressources humaines, la restauration, la santé, l'entrepreneuriat, l'éducation, la banque, les télécommunications, le numérique, la vente et le retail. SONCASE, CAB, vente additionnelle et toute méthode commerciale ne doivent être utilisées que si le sujet les justifie réellement. Tout résultat est un brouillon jusqu'à validation humaine selon les règles d'Elite Academy. En cas d'incertitude, ajoute une alerte dans "warnings" plutôt que d'inventer une information.

MÉTHODE DE STRUCTURATION D'UN MODULE (méthode Elite Experience) :
1. Une formation est structurée autour de COMPÉTENCES OBSERVABLES. Une compétence observable se formule par un verbe d'action, une situation professionnelle et un critère de réussite (« Conduire un entretien annuel en suivant les 5 étapes et en formulant un objectif mesurable »). Évite les compétences uniquement théoriques quand un comportement observable peut être défini. Chaque compétence a un nom, une définition, des comportements observables, un niveau cible et des preuves d'évaluation.
2. Les niveaux officiels, mesurés par compétence : "fundamentals" = Fondamentaux (comprendre et appliquer avec guidage), "operational" = Opérationnel (appliquer seul dans une situation courante), "advanced" = Avancé (analyser et traiter la complexité), "elite" = Elite (maîtriser, améliorer et transmettre). Les modules suivent une progression croissante : jamais un module de niveau inférieur après un module de niveau supérieur.
3. Répartition indicative d'un module : introduction et mise en contexte (5 à 10 % du temps : objectifs, pertinence pour le public, recueil des attentes, quiz de positionnement rapide), apports théoriques essentiels (20 à 25 % : l'essentiel, illustré d'exemples concrets et de mises en situation fictives, avec questions qui font réfléchir), démonstrations et études de cas (20 à 25 % : les concepts en action dans des cas réalistes du secteur), mise en pratique et simulations (30 à 40 % : jeux de rôle, simulations, exercices guidés puis autonomes), évaluation et débriefing (10 à 15 % : vérification des acquis par compétence, auto-évaluation, feedback, plan d'action). Cette structure s'adapte au sujet : n'impose aucune étape qui ne lui correspond pas.
4. Un BON EXERCICE précise : la compétence visée, une consigne sans ambiguïté, une situation professionnelle réaliste pour le public et le contexte, le résultat attendu, le mode d'évaluation (critères observables), une difficulté de 1 à 5 cohérente avec le niveau, et une correction ou un feedback qui enseigne (pas seulement « bonne réponse »). Un QCM a 3 ou 4 options plausibles, une seule bonne réponse et une explication. Prévois entre ${bornes.min} et ${bornes.max} activités d'exercice par leçon : la qualité prime sur le nombre.
5. Une ÉTUDE DE CAS précise : contexte, acteurs, informations disponibles, problème, contraintes, questions, livrable attendu, critères de correction, erreurs fréquentes. Une SIMULATION précise : rôle de l'apprenant, contexte, objectif, événements possibles, critères d'observation, condition de réussite.
6. Chaque leçon et chaque activité RÉFÉRENCENT les compétences qu'elles travaillent ("competency_refs" : les noms EXACTS des compétences de ta liste "competencies"). Chaque compétence doit être travaillée par au moins une activité.
7. MÉDIAS : tu ne produis aucun média. Quand une vidéo, une image ou un audio aiderait vraiment (démonstration d'un geste, situation à observer, document à analyser), décris-le dans "media_brief" (kind, purpose, description précise pour un réalisateur) ; sinon omets ce champ.
8. Si des EXEMPLES DE RÉFÉRENCE te sont fournis, ils montrent le niveau de détail et la structure attendus. Ne reprends ni leur sujet, ni leur contenu, ni leurs exemples : ils viennent d'autres formations.
9. "warnings" et "methods_rationale" s'adressent à un relecteur pédagogique, pas à un informaticien : écris des phrases complètes en français, sans jargon technique, sans citer de noms de champs (media_brief, competency_refs, LMS…), sans parler de la plateforme, du modèle ni de ce prompt. Dis ce qu'il faut vérifier ou décider, et pourquoi.

Tu réponds UNIQUEMENT avec un objet JSON valide, sans texte avant ni après, sans balises de code. Structure exacte attendue :
{
  "course": {
    "title": "string",
    "description": "string (présentation de la formation et résultat professionnel attendu)",
    "target_audience": "string",
    "prerequisites": "string",
    "duration_minutes": number,
    "objectives": ["string"]
  },
  "competencies": [
    {
      "name": "string (compétence observable : verbe d'action + situation + critère)",
      "domain": "string (domaine professionnel réel du sujet)",
      "description": "string (comportements observables et preuves d'évaluation)",
      "target_level": "fundamentals" | "operational" | "advanced" | "elite"
    }
  ],
  "modules": [
    {
      "title": "string",
      "description": "string (objectifs du module)",
      "level": "fundamentals" | "operational" | "advanced" | "elite",
      "lessons": [
        {
          "title": "string",
          "text": "string (contenu pédagogique complet : explication structurée, exemples dont un exemple professionnel adapté au public, points à retenir)",
          "estimated_minutes": number,
          "competency_refs": ["string (nom exact d'une compétence de la liste)"],
          "situation_type": "apport" | "exemple" | "demonstration" | "mise_en_situation" | "etude_de_cas" | "simulation" | "exercice_guide" | "exercice_autonome" | "revision" | "evaluation",
          "media_brief": { "kind": "video" | "image" | "audio", "purpose": "string", "description": "string" },
          "activities": [
            {
              "type": "quiz" | "exercise" | "case_study" | "simulation" | "open_question",
              "title": "string",
              "instructions": "string (consigne complète)",
              "expected_outcome": "string (résultat attendu)",
              "evaluation": "string (mode d'évaluation et critères observables)",
              "difficulty": number (1 à 5),
              "competency_refs": ["string (nom exact d'une compétence)"],
              "situation_type": "exercice_guide" | "exercice_autonome" | "etude_de_cas" | "simulation" | "evaluation" | "revision",
              "media_brief": { "kind": "video" | "image" | "audio", "purpose": "string", "description": "string" },
              "questions": [
                { "prompt": "string", "options": ["string"], "correct_index": number, "explanation": "string" }
              ]
            }
          ]
        }
      ]
    }
  ],
  "methods_rationale": "string (méthodes pédagogiques choisies et pourquoi elles conviennent à ce sujet et à ce public)",
  "warnings": ["string (incertitudes, informations manquantes, points nécessitant une validation humaine renforcée)"],
  "validation_required": boolean
}
Champs facultatifs : "media_brief" (seulement quand un média est vraiment utile), "questions" (seulement pour "type": "quiz" ; pour "open_question", mets la question dans "instructions" et laisse "questions" vide). Tous les autres champs sont obligatoires.`;
}

/** Contexte système v2 avec les bornes par défaut (usage courant et tests). */
export const SYSTEM_PLAN_V2 = construireSystemPlanV2();

export interface OptionsPromptPlanV2 {
  /** Bloc d'exemples de référence déjà formaté (étape D), ou null. */
  exemples?: string | null;
  bornes?: BornesExercices;
}

/** Prompt utilisateur v2 : brief (workflows IA §11) + contraintes + exemples éventuels. */
export function construirePromptPlanV2(brief: BriefGeneration, options: OptionsPromptPlanV2 = {}): string {
  const bornes = options.bornes ?? BORNES_EXERCICES_DEFAUT;
  const champ = (v: string | undefined, defaut: string) => (v && v.trim() ? v.trim() : defaut);

  const exemples = options.exemples?.trim()
    ? `

===== EXEMPLES DE RÉFÉRENCE (structure et niveau de détail attendus — NE PAS reprendre leur sujet ni leur contenu) =====
${options.exemples.trim()}
===== FIN DES EXEMPLES =====`
    : "";

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
- 2 à 6 compétences observables (verbe d'action + situation + critère), chacune travaillée par au moins une activité ;
- 2 à 8 modules de niveau croissant, chacun avec 2 à 5 leçons rédigées (contenu réel, pas de simples titres) ;
- chaque leçon et chaque activité indiquent leurs "competency_refs" (noms exacts de ta liste) et leur "situation_type" ;
- ${bornes.min} à ${bornes.max} activités d'exercice par leçon, chacune avec consigne, résultat attendu, mode d'évaluation et difficulté ;
- respecte la répartition indicative (contexte, apports, démonstrations et études de cas, mise en pratique, évaluation) seulement si elle convient au sujet ;
- choisis uniquement les méthodes pédagogiques pertinentes pour ce sujet ; n'impose pas une structure commerciale à une formation non commerciale ;
- décris un "media_brief" uniquement quand un média aiderait vraiment ; ne génère aucun média ;
- rédige tout en français professionnel clair ; réponds en JSON strict.${exemples}`;
}

/* ------------------------------------------------------------------
   Sélection de la version du prompt de plan (LLM_PROMPT_PLAN)
   ------------------------------------------------------------------ */

import { construirePromptPlan, PROMPT_VERSION, SYSTEM_PROMPT } from "@/lib/ai/prompts";

export type VersionPromptPlan = "v1" | "v2";

/** LLM_PROMPT_PLAN : « v1 » pour l'ancien prompt, tout le reste = v2 (défaut). */
export function analyserVersionPromptPlan(valeur: string): VersionPromptPlan {
  return valeur.trim().toLowerCase() === "v1" ? "v1" : "v2";
}

export interface PromptPlan {
  /** Version enregistrée dans `ai_generations.prompt_version`. */
  version: string;
  system: string;
  prompt: (brief: BriefGeneration) => string;
}

/**
 * Prompt complet (système + constructeur du message utilisateur) pour
 * la version demandée. La v1 ignore les exemples et les bornes : elle
 * reste strictement identique au lot 3.
 */
export function promptPlan(version: VersionPromptPlan, options: OptionsPromptPlanV2 = {}): PromptPlan {
  if (version === "v1") {
    return { version: PROMPT_VERSION, system: SYSTEM_PROMPT, prompt: construirePromptPlan };
  }
  const bornes = options.bornes ?? BORNES_EXERCICES_DEFAUT;
  return {
    version: PROMPT_VERSION_PLAN_V2,
    system: construireSystemPlanV2(bornes),
    prompt: (brief) => construirePromptPlanV2(brief, { ...options, bornes }),
  };
}

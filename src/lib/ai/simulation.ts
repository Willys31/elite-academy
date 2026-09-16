import type { BriefGeneration } from "@/lib/ai/prompts";

/**
 * Mode simulation : produit un résultat de démonstration SANS appel
 * au LLM (aucune clé API, aucun coût). Sert à tester l'ensemble du
 * pipeline — traçabilité, création du brouillon, validation — avant
 * de disposer d'une clé API.
 *
 * Le contenu est volontairement générique et CLAIREMENT étiqueté
 * « démonstration » : il ne doit jamais être publié tel quel.
 * Activation : ELITE_IA_MODE=simulation dans .env.local.
 */
export function genererSimulation(brief: BriefGeneration): string {
  const sujet = brief.sujet.trim();
  const titreCourt =
    sujet.length > 70 ? `${sujet.slice(0, 67)}…` : sujet;
  const publicCible = brief.public_cible?.trim() || "professionnels concernés par le sujet";
  const duree = brief.duree?.trim() || "1 journée (environ 6 heures)";

  const marque =
    "[DÉMONSTRATION — contenu généré en mode simulation, sans IA. À remplacer par une vraie génération avant toute utilisation pédagogique.]";

  const lecon = (titre: string, minutes: number) => ({
    title: titre,
    text: `${marque}\n\nCette leçon traiterait de : ${titre.toLowerCase()}, en lien avec le besoin « ${titreCourt} ».\n\nStructure prévue : explication de la notion, exemple de la vie professionnelle adapté au public (${publicCible}), points à retenir, et courte activité d'application.`,
    estimated_minutes: minutes,
  });

  const resultat = {
    course: {
      title: `[DÉMO] ${titreCourt}`,
      description: `${marque}\n\nFormation de démonstration créée à partir du besoin suivant : ${sujet}`,
      target_audience: publicCible,
      prerequisites: "Aucun prérequis (contenu de démonstration).",
      duration_minutes: 360,
      objectives: [
        "Objectif de démonstration 1 : comprendre les notions essentielles du sujet.",
        "Objectif de démonstration 2 : appliquer une méthode simple en situation professionnelle.",
        `Durée indicative demandée : ${duree}.`,
      ],
    },
    competencies: [
      {
        name: `[DÉMO] Appliquer les fondamentaux — ${titreCourt.slice(0, 40)}`,
        domain: brief.secteur?.trim() || "général",
        description:
          "Compétence de démonstration : comportements observables à définir lors d'une vraie génération.",
        target_level: "fundamentals",
      },
      {
        name: `[DÉMO] Traiter une situation courante — ${titreCourt.slice(0, 40)}`,
        domain: brief.secteur?.trim() || "général",
        description:
          "Compétence de démonstration : application autonome dans une situation professionnelle courante.",
        target_level: "operational",
      },
    ],
    modules: [
      {
        title: "[DÉMO] Module 1 — Comprendre les notions essentielles",
        description: "Module de démonstration : apports et exemples.",
        lessons: [lecon("Les notions clés du sujet", 30), lecon("Exemples professionnels", 30)],
      },
      {
        title: "[DÉMO] Module 2 — Mettre en pratique",
        description: "Module de démonstration : exercices guidés puis autonomes.",
        lessons: [
          lecon("Exercice guidé pas à pas", 45),
          lecon("Mise en situation autonome", 45),
        ],
      },
    ],
    methods_rationale:
      "Mode simulation : aucune analyse pédagogique réelle n'a été effectuée. Lors d'une vraie génération, les méthodes seraient choisies selon le sujet, le public et les compétences (jamais de méthode commerciale imposée à un sujet non commercial).",
    warnings: [
      "CONTENU DE DÉMONSTRATION généré en mode simulation, sans appel au LLM.",
      "Ne pas publier ce contenu : il sert uniquement à tester le parcours de création, de relecture et de validation.",
    ],
    validation_required: true,
  };

  return JSON.stringify(resultat);
}

/**
 * Analyse de session de démonstration (lot 17), sans appel au LLM.
 * Les locuteurs et quelques extraits sont pris dans la transcription
 * pour que le bilan ressemble à une vraie analyse, mais tout est
 * étiqueté démonstration.
 */
export function simulerAnalyseSession(params: {
  titre: string;
  formateur: string;
  locuteurs: string[];
  extraits: Array<{ locuteur: string; texte: string }>;
}): string {
  const marque = "[DÉMONSTRATION — analyse produite en mode simulation, sans IA.]";
  const participants = params.locuteurs.filter((l) => l !== params.formateur);
  const interventions = params.extraits.slice(0, 6).map((e, i) => ({
    speaker: e.locuteur,
    start_seconds: i * 90,
    end_seconds: i * 90 + 30,
    type: e.texte.includes("?") ? "question" : e.locuteur === params.formateur ? "answer" : "remark",
    snippet: e.texte.slice(0, 160),
    quality_score: e.texte.includes("?") ? 4 : null,
  }));
  const resultat = {
    summary: `${marque}\n\nSession « ${params.titre} » animée par ${params.formateur}. ${params.locuteurs.length} locuteur(s) identifié(s) dans la transcription. Lors d'une vraie analyse, ce résumé reprendrait les objectifs annoncés, les notions traitées, les exemples donnés et les conclusions de la séance.`,
    key_points: [
      "[DÉMO] Point clé 1 : notion principale traitée pendant la session.",
      "[DÉMO] Point clé 2 : exemple professionnel développé par le formateur.",
      "[DÉMO] Point clé 3 : question récurrente des participants.",
    ],
    keywords: ["démonstration", "session", "analyse"],
    interventions,
    insights: {
      trainer_talk_ratio: 0.65,
      participation_rate: participants.length > 0 ? Math.min(1, participants.length / Math.max(1, params.locuteurs.length)) : 0,
      recommendations_trainer: [
        "[DÉMO] Laisser un temps de silence après chaque question pour favoriser les prises de parole.",
        "[DÉMO] Reformuler les questions des participants avant d'y répondre.",
      ],
      recommendations_learners: ["[DÉMO] Préparer une question avant la prochaine session."],
      warnings: ["CONTENU DE DÉMONSTRATION généré en mode simulation, sans appel au LLM."],
    },
  };
  return JSON.stringify(resultat);
}

/** Aide de démonstration (lot 18), sans appel au LLM. */
export function simulerAide(type: string, enonce: string): string {
  const marque = "[DÉMO — tuteur en mode simulation, sans IA]";
  const court = enonce.slice(0, 120);
  const textes: Record<string, string> = {
    reformulate: `${marque} Autrement dit : « ${court} ». La question vous demande d'identifier, parmi les options, celle qui respecte la règle vue dans la leçon. Relisez la définition, puis éliminez les options qui la contredisent.`,
    dont_understand: `${marque} La notion en jeu est celle que la leçon présente juste avant cette question. Imaginez-la dans votre quotidien professionnel : que se passerait-il si on l'appliquait mal ? C'est souvent ainsi qu'on comprend pourquoi elle existe.`,
    hint: `${marque} Indice de méthode : commencez par repérer ce que la question mesure exactement, puis vérifiez chaque option une à une contre cette définition. Une seule survit.`,
    example: `${marque} Exemple similaire : avec d'autres chiffres ou une autre situation, la même règle s'applique. Refaites le raisonnement pas à pas sur cet exemple, puis transposez-le à la question.`,
    detailed_explanation: `${marque} Explication détaillée : la bonne réponse est celle qui applique strictement la règle de la leçon ; l'erreur classique consiste à confondre deux notions proches. Relisez l'explication de la correction et refaites une tentative.`,
  };
  return textes[type] ?? textes.hint;
}

/** Exercices de démonstration (lot 18), sans appel au LLM. */
export function simulerExercices(competence: string, typeExercice: string, nb: number): string {
  const marque = "[DÉMO]";
  const exercises = Array.from({ length: Math.max(1, Math.min(5, nb)) }, (_, i) => ({
    title: `${marque} ${typeExercice} ${i + 1} — ${competence}`,
    instructions:
      "Contenu de démonstration généré en mode simulation. Une seule bonne réponse par question.",
    type: typeExercice,
    difficulty: 2,
    questions: [
      {
        prompt: `${marque} Quelle affirmation décrit le mieux la compétence « ${competence} » ?`,
        options: [
          "Une capacité observable, mesurée par des critères",
          "Une opinion personnelle",
          "Un titre honorifique",
        ],
        correct_index: 0,
        explanation:
          "Une compétence est un comportement observable et mesurable — c'est le principe de la plateforme.",
      },
      {
        prompt: `${marque} Face à une situation nouvelle, quelle démarche mobilise cette compétence ?`,
        options: ["Agir sans analyser", "Analyser, décider, puis vérifier le résultat", "Attendre une consigne"],
        correct_index: 1,
        explanation:
          "Analyser puis vérifier : c'est ce qui distingue le niveau Opérationnel du niveau Fondamentaux.",
      },
    ],
  }));
  return JSON.stringify({ exercises });
}

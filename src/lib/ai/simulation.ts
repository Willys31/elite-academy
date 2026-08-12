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

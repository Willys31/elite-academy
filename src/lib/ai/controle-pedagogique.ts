/**
 * Contrôle pédagogique d'un plan de formation généré — lot 25, étape E.
 * Logique pure, testée. S'applique APRÈS `validerResultat` (structure)
 * et AVANT l'enregistrement du brouillon.
 *
 * Deux niveaux (workflows IA §24, §27) :
 * - erreurs BLOQUANTES : la structure est inutilisable pour le suivi par
 *   compétence ; elles déclenchent une relance de réparation
 *   (`reparation.ts`) ;
 * - AVERTISSEMENTS : ajoutés aux `warnings` du résultat, visibles du
 *   validateur humain ; rien n'est corrigé automatiquement.
 *
 * Le contenu reste un brouillon : aucun contrôle ne change un statut.
 */

import type { ResultatGeneration } from "@/lib/ai/schema";
import { NIVEAUX_CIBLES } from "@/lib/ai/schema";
import {
  BORNES_EXERCICES_DEFAUT,
  TYPES_ACTIVITE_GENEREE,
  TYPES_MEDIA,
  TYPES_SITUATION,
  type BornesExercices,
} from "@/lib/ai/prompts-plan-v2";
import { estCommercial } from "@/lib/ai/exemples/selection";

export type CodeControle =
  | "STRUCTURE_INVALIDE"
  | "ACTIVITE_SANS_COMPETENCE"
  | "COMPETENCE_INCONNUE"
  | "COMPETENCE_NON_TRAVAILLEE"
  | "LECON_SANS_COMPETENCE"
  | "ACTIVITE_INCOMPLETE"
  | "QUIZ_SANS_QUESTION"
  | "TYPE_ACTIVITE_INCONNU"
  | "EXERCICES_TROP_NOMBREUX"
  | "EXERCICES_TROP_PEU"
  | "NIVEAU_MODULE_ABSENT"
  | "PROGRESSION_INCOHERENTE"
  | "SITUATION_INCONNUE"
  | "METHODE_COMMERCIALE_INJUSTIFIEE"
  | "MEDIA_BRIEF_INVALIDE";

export interface Probleme {
  code: CodeControle;
  /** Message en français, destiné au validateur humain et au modèle (réparation). */
  message: string;
  /** Emplacement dans le JSON, ex. `modules[0].lessons[1].activities[0]`. */
  chemin: string;
}

export interface RapportControle {
  ok: boolean;
  erreurs: Probleme[];
  avertissements: Probleme[];
}

export interface OptionsControle {
  /** v2 : les champs de compétences par activité sont exigés ; v1 : contrôles allégés. */
  version: "v1" | "v2";
  bornes?: BornesExercices;
  /** Le sujet relève-t-il du commerce ? Sinon, les méthodes commerciales sont signalées. */
  sujetCommercial: boolean;
}

/** Méthodes commerciales à signaler hors sujet commercial (instructions §9, workflows §26). */
const METHODES_COMMERCIALES = /\bSONCASE?\b|\bCAB\b|vente additionnelle|cross[- ]?selling|up[- ]?selling|\bAIDA\b|\bSPIN selling\b/i;

/** Lit les bornes d'exercices depuis l'environnement (valeurs invalides → défaut). */
export function bornesExercicesDepuis(env: (nom: string) => string): BornesExercices {
  const min = Number.parseInt(env("LLM_EXERCICES_MIN"), 10);
  const max = Number.parseInt(env("LLM_EXERCICES_MAX"), 10);
  const bMin = Number.isInteger(min) && min >= 0 ? min : BORNES_EXERCICES_DEFAUT.min;
  const bMax = Number.isInteger(max) && max >= 1 ? max : BORNES_EXERCICES_DEFAUT.max;
  return bMax >= bMin ? { min: bMin, max: bMax } : BORNES_EXERCICES_DEFAUT;
}

/** Un sujet est commercial si le secteur, le sujet ou le public le disent. */
export function sujetEstCommercial(brief: { sujet?: string; secteur?: string; public_cible?: string }): boolean {
  return estCommercial(brief.secteur) || estCommercial(brief.sujet) || estCommercial(brief.public_cible);
}

const normaliser = (s: string) => s.trim().toLowerCase();

/** Types d'activité comptés comme « exercice » pour les bornes par leçon. */
const TYPES_EXERCICE = new Set<string>(["quiz", "exercise", "case_study", "simulation", "open_question"]);

export function controlerPlan(r: ResultatGeneration, options: OptionsControle): RapportControle {
  const erreurs: Probleme[] = [];
  const avertissements: Probleme[] = [];
  const bornes = options.bornes ?? BORNES_EXERCICES_DEFAUT;
  const v2 = options.version === "v2";

  const competences = new Map(r.competencies.map((c) => [normaliser(c.name), c]));
  const travaillees = new Set<string>();

  const verifierRefs = (refs: string[], chemin: string, lieu: string) => {
    const connues = refs.filter((n) => competences.has(normaliser(n)));
    const inconnues = refs.filter((n) => !competences.has(normaliser(n)));
    for (const n of connues) travaillees.add(normaliser(n));
    if (inconnues.length > 0) {
      avertissements.push({
        code: "COMPETENCE_INCONNUE",
        chemin,
        message: `${lieu} référence une compétence absente de la liste "competencies" : ${inconnues.map((n) => `« ${n} »`).join(", ")}. Utiliser les noms exacts.`,
      });
    }
    return connues.length;
  };

  const verifierMedia = (media: { kind: string; purpose: string; description: string } | null, chemin: string, lieu: string) => {
    if (!media) return;
    const problemes: string[] = [];
    if (!(TYPES_MEDIA as readonly string[]).includes(media.kind)) {
      problemes.push(`"kind" doit être ${TYPES_MEDIA.map((t) => `"${t}"`).join(", ")} (reçu « ${media.kind || "vide"} »)`);
    }
    if (!media.description) problemes.push('"description" est vide');
    if (!media.purpose) problemes.push('"purpose" est vide');
    if (problemes.length > 0) {
      avertissements.push({
        code: "MEDIA_BRIEF_INVALIDE",
        chemin: `${chemin}.media_brief`,
        message: `${lieu}.media_brief est mal formé : ${problemes.join(" ; ")}.`,
      });
    }
  };

  const verifierSituation = (situation: string | null, chemin: string, lieu: string) => {
    if (!v2) return;
    if (situation === null) {
      avertissements.push({ code: "SITUATION_INCONNUE", chemin, message: `${lieu} n'indique pas de "situation_type".` });
    } else if (!(TYPES_SITUATION as readonly string[]).includes(situation)) {
      avertissements.push({
        code: "SITUATION_INCONNUE",
        chemin,
        message: `${lieu} a un "situation_type" inconnu (« ${situation} »). Valeurs : ${TYPES_SITUATION.join(", ")}.`,
      });
    }
  };

  const verifierMethodesCommerciales = (texte: string, chemin: string, lieu: string) => {
    if (options.sujetCommercial) return;
    const m = texte.match(METHODES_COMMERCIALES);
    if (m) {
      avertissements.push({
        code: "METHODE_COMMERCIALE_INJUSTIFIEE",
        chemin,
        message: `${lieu} mobilise une méthode commerciale (« ${m[0]} ») alors que le sujet n'est pas commercial : à justifier ou à retirer.`,
      });
    }
  };

  let niveauPrecedent = -1;
  r.modules.forEach((module, im) => {
    const cheminModule = `modules[${im}]`;
    const lieuModule = `Module ${im + 1}`;
    verifierMethodesCommerciales(`${module.title}\n${module.description}`, cheminModule, lieuModule);

    if (module.level === null) {
      if (v2) {
        avertissements.push({ code: "NIVEAU_MODULE_ABSENT", chemin: cheminModule, message: `${lieuModule} (« ${module.title} ») n'indique pas de niveau valide (fundamentals, operational, advanced, elite).` });
      }
    } else {
      const rang = NIVEAUX_CIBLES.indexOf(module.level);
      if (rang < niveauPrecedent) {
        avertissements.push({
          code: "PROGRESSION_INCOHERENTE",
          chemin: cheminModule,
          message: `${lieuModule} (« ${module.title} », niveau ${module.level}) suit un module de niveau supérieur : la progression doit être croissante.`,
        });
      }
      niveauPrecedent = Math.max(niveauPrecedent, rang);
    }

    module.lessons.forEach((lecon, il) => {
      const cheminLecon = `${cheminModule}.lessons[${il}]`;
      const lieuLecon = `${lieuModule}, leçon ${il + 1}`;
      verifierMethodesCommerciales(`${lecon.title}\n${lecon.text}`, cheminLecon, lieuLecon);
      verifierSituation(lecon.situation_type, cheminLecon, lieuLecon);
      verifierMedia(lecon.media_brief, cheminLecon, lieuLecon);

      if (v2) {
        const connues = verifierRefs(lecon.competency_refs, cheminLecon, lieuLecon);
        if (connues === 0) {
          avertissements.push({
            code: "LECON_SANS_COMPETENCE",
            chemin: cheminLecon,
            message: `${lieuLecon} (« ${lecon.title} ») ne référence aucune compétence existante dans "competency_refs".`,
          });
        }
      }

      let exercices = 0;
      lecon.activities.forEach((act, ia) => {
        const cheminAct = `${cheminLecon}.activities[${ia}]`;
        const lieuAct = `${lieuLecon}, activité ${ia + 1}`;
        if (TYPES_EXERCICE.has(act.type)) exercices += 1;
        verifierMethodesCommerciales(`${act.title}\n${act.instructions}\n${act.evaluation}`, cheminAct, lieuAct);
        verifierSituation(act.situation_type, cheminAct, lieuAct);
        verifierMedia(act.media_brief, cheminAct, lieuAct);

        if (!(TYPES_ACTIVITE_GENEREE as readonly string[]).includes(act.type)) {
          avertissements.push({
            code: "TYPE_ACTIVITE_INCONNU",
            chemin: cheminAct,
            message: `${lieuAct} a un "type" inconnu (« ${act.type} »). Valeurs : ${TYPES_ACTIVITE_GENEREE.join(", ")}.`,
          });
        }
        if (act.type === "quiz" && act.questions.length === 0) {
          erreurs.push({
            code: "QUIZ_SANS_QUESTION",
            chemin: cheminAct,
            message: `${lieuAct} (« ${act.title} ») est un quiz sans aucune question valide (énoncé, 2 à 6 options, "correct_index" dans les bornes).`,
          });
        }
        if (act.type !== "quiz" && !act.instructions) {
          erreurs.push({
            code: "ACTIVITE_INCOMPLETE",
            chemin: cheminAct,
            message: `${lieuAct} (« ${act.title} ») n'a pas de consigne ("instructions").`,
          });
        }
        if (v2 && !act.evaluation) {
          avertissements.push({
            code: "ACTIVITE_INCOMPLETE",
            chemin: cheminAct,
            message: `${lieuAct} (« ${act.title} ») n'indique pas de mode d'évaluation ("evaluation").`,
          });
        }
        if (v2) {
          const connues = verifierRefs(act.competency_refs, cheminAct, lieuAct);
          if (connues === 0) {
            erreurs.push({
              code: "ACTIVITE_SANS_COMPETENCE",
              chemin: cheminAct,
              message: `${lieuAct} (« ${act.title} ») ne référence aucune compétence existante : "competency_refs" doit contenir au moins un nom exact de "competencies".`,
            });
          }
        }
      });

      // Bornes du nombre d'exercices par leçon. Le quiz importé (v1) compte aussi.
      if (lecon.quiz) exercices += 1;
      if (v2) {
        if (exercices > bornes.max) {
          erreurs.push({
            code: "EXERCICES_TROP_NOMBREUX",
            chemin: cheminLecon,
            message: `${lieuLecon} (« ${lecon.title} ») compte ${exercices} activités d'exercice ; le maximum est ${bornes.max}. Garder les plus pertinentes.`,
          });
        } else if (exercices < bornes.min) {
          avertissements.push({
            code: "EXERCICES_TROP_PEU",
            chemin: cheminLecon,
            message: `${lieuLecon} (« ${lecon.title} ») compte ${exercices} activité(s) d'exercice ; le minimum attendu est ${bornes.min}.`,
          });
        }
      }
    });
  });

  if (v2) {
    for (const c of r.competencies) {
      if (!travaillees.has(normaliser(c.name))) {
        erreurs.push({
          code: "COMPETENCE_NON_TRAVAILLEE",
          chemin: "competencies",
          message: `La compétence « ${c.name} » n'est travaillée par aucune activité : ajouter une activité qui la référence, ou la retirer.`,
        });
      }
    }
  }

  return { ok: erreurs.length === 0, erreurs, avertissements };
}

/** Avertissements formatés pour `warnings` (visibles du validateur). */
export function avertissementsEnTexte(avertissements: Probleme[], maximum = 20): string[] {
  return avertissements.slice(0, maximum).map((a) => `Contrôle pédagogique : ${a.message}`);
}

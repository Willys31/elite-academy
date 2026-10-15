/**
 * Validation et normalisation du résultat JSON produit par le LLM.
 * Logique pure, sans dépendance — testée unitairement.
 *
 * Principe (workflows IA §28) : champs stables, et en cas de
 * structure invalide on rejette avec un message clair plutôt que
 * d'enregistrer un contenu incohérent.
 */

const NIVEAUX = ["fundamentals", "operational", "advanced", "elite"] as const;
export type NiveauCible = (typeof NIVEAUX)[number];

export interface QuestionGeneree {
  prompt: string;
  options: string[];
  correct_index: number;
  explanation: string | null;
}

export interface QuizGenere {
  title: string;
  questions: QuestionGeneree[];
}

/** Pages ou diapositives du document source dont la leçon reprend la matière. */
export interface IntervalleGenere {
  from: number;
  to: number;
}

export interface LeconGeneree {
  title: string;
  text: string;
  estimated_minutes: number | null;
  quiz: QuizGenere | null;
  source_range: IntervalleGenere | null;
}

export interface ModuleGenere {
  title: string;
  description: string;
  lessons: LeconGeneree[];
}

export interface CompetenceGeneree {
  name: string;
  domain: string;
  description: string;
  target_level: NiveauCible;
}

export interface ResultatGeneration {
  course: {
    title: string;
    description: string;
    target_audience: string;
    prerequisites: string;
    duration_minutes: number | null;
    objectives: string[];
  };
  competencies: CompetenceGeneree[];
  modules: ModuleGenere[];
  methods_rationale: string;
  warnings: string[];
  validation_required: boolean;
}

export type Analyse =
  | { ok: true; resultat: ResultatGeneration }
  | { ok: false; erreur: string };

/**
 * Extraction JSON tolérante (balises de code, prose, blocs <think>,
 * virgules finales) : implémentée dans `json.ts`, ré-exportée ici pour
 * les appelants historiques.
 */
export { extraireJson } from "@/lib/ai/json";

function texteOuVide(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function nombreOuNull(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v) && v >= 0) return Math.round(v);
  return null;
}

function tableau(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

/**
 * Valide un quiz extrait d'un document : questions avec au moins
 * deux options et une bonne réponse valide. Retourne null si rien
 * d'exploitable (le quiz est alors simplement ignoré).
 */
function validerQuiz(brut: unknown): QuizGenere | null {
  if (brut === null || typeof brut !== "object") return null;
  const q = brut as Record<string, unknown>;
  const questions: QuestionGeneree[] = tableau(q.questions)
    .map((item) => {
      const qq = (item ?? {}) as Record<string, unknown>;
      const options = tableau(qq.options).map(texteOuVide).filter(Boolean).slice(0, 6);
      const index = Number(qq.correct_index);
      return {
        prompt: texteOuVide(qq.prompt),
        options,
        correct_index:
          Number.isInteger(index) && index >= 0 && index < options.length ? index : -1,
        explanation: texteOuVide(qq.explanation) || null,
      };
    })
    .filter((x) => x.prompt && x.options.length >= 2 && x.correct_index >= 0)
    .slice(0, 20);

  if (questions.length === 0) return null;
  return {
    title: texteOuVide(q.title) || "Quiz de la leçon",
    questions,
  };
}

/** Lignes-repères [[PAGE n]] / [[DIAPOSITIVE n]] qu'un modèle aurait recopiées. */
const MARQUEUR_RECOPIE = /^\s*\[\[(?:PAGE|DIAPOSITIVE) \d+[^\]]*\]\]\s*$/gm;

function nettoyerTexteLecon(v: unknown): string {
  return texteOuVide(v).replace(MARQUEUR_RECOPIE, "").replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * Intervalle de pages/diapositives d'une leçon : entiers, ordonnés,
 * dans les bornes du document. Hors bornes → `null` et un avertissement
 * est ajouté, la leçon restera simplement sans extrait.
 */
function validerIntervalle(
  brut: unknown,
  titre: string,
  totalUnites: number | undefined,
  avertissements: string[]
): IntervalleGenere | null {
  if (brut === null || typeof brut !== "object") return null;
  const i = brut as Record<string, unknown>;
  const from = Number(i.from);
  const to = Number(i.to);
  if (!Number.isInteger(from) || !Number.isInteger(to)) return null;
  const total = totalUnites ?? Number.MAX_SAFE_INTEGER;
  if (from < 1 || to < from || to > total) {
    avertissements.push(
      `Intervalle ignoré pour la leçon « ${titre} » : ${from}–${to} est hors du document${
        totalUnites ? ` (${totalUnites} au total)` : ""
      }.`
    );
    return null;
  }
  return { from, to };
}

/**
 * Valide et normalise le résultat brut du LLM.
 * Rejette si les éléments indispensables manquent (titre, au moins
 * une compétence, au moins un module avec au moins une leçon rédigée).
 *
 * `totalUnites` : nombre de pages ou de diapositives du document,
 * pour borner les intervalles `source_range` renvoyés par le modèle.
 */
export function validerResultat(
  brut: unknown,
  options: { totalUnites?: number } = {}
): Analyse {
  if (brut === null || typeof brut !== "object") {
    return { ok: false, erreur: "La réponse de l'IA n'est pas un objet JSON valide." };
  }
  const r = brut as Record<string, unknown>;
  const avertissementsIntervalles: string[] = [];

  const courseBrut = (r.course ?? {}) as Record<string, unknown>;
  const title = texteOuVide(courseBrut.title);
  if (!title) {
    return { ok: false, erreur: "La réponse de l'IA ne contient pas de titre de formation." };
  }

  const competencies: CompetenceGeneree[] = tableau(r.competencies)
    .map((c) => {
      const cc = (c ?? {}) as Record<string, unknown>;
      const niveau = texteOuVide(cc.target_level);
      return {
        name: texteOuVide(cc.name),
        domain: texteOuVide(cc.domain) || "général",
        description: texteOuVide(cc.description),
        target_level: (NIVEAUX as readonly string[]).includes(niveau)
          ? (niveau as NiveauCible)
          : "fundamentals",
      };
    })
    .filter((c) => c.name.length > 0)
    .slice(0, 10);

  if (competencies.length === 0) {
    return { ok: false, erreur: "La réponse de l'IA ne contient aucune compétence exploitable." };
  }

  const modules: ModuleGenere[] = tableau(r.modules)
    .map((m) => {
      const mm = (m ?? {}) as Record<string, unknown>;
      const lessons: LeconGeneree[] = tableau(mm.lessons)
        .map((l) => {
          const ll = (l ?? {}) as Record<string, unknown>;
          const title = texteOuVide(ll.title);
          return {
            title,
            text: nettoyerTexteLecon(ll.text),
            estimated_minutes: nombreOuNull(ll.estimated_minutes),
            quiz: validerQuiz(ll.quiz),
            source_range: validerIntervalle(
              ll.source_range,
              title,
              options.totalUnites,
              avertissementsIntervalles
            ),
          };
        })
        .filter((l) => l.title.length > 0)
        .slice(0, 12);
      return {
        title: texteOuVide(mm.title),
        description: texteOuVide(mm.description),
        lessons,
      };
    })
    .filter((m) => m.title.length > 0)
    .slice(0, 12);

  if (modules.length === 0 || modules.every((m) => m.lessons.length === 0)) {
    return {
      ok: false,
      erreur: "La réponse de l'IA ne contient aucun module avec des leçons exploitables.",
    };
  }

  return {
    ok: true,
    resultat: {
      course: {
        title,
        description: texteOuVide(courseBrut.description),
        target_audience: texteOuVide(courseBrut.target_audience),
        prerequisites: texteOuVide(courseBrut.prerequisites),
        duration_minutes: nombreOuNull(courseBrut.duration_minutes),
        objectives: tableau(courseBrut.objectives)
          .map(texteOuVide)
          .filter(Boolean)
          .slice(0, 12),
      },
      competencies,
      modules,
      methods_rationale: texteOuVide(r.methods_rationale),
      warnings: [
        ...tableau(r.warnings).map(texteOuVide).filter(Boolean),
        ...avertissementsIntervalles,
      ].slice(0, 20),
      validation_required:
        typeof r.validation_required === "boolean" ? r.validation_required : true,
    },
  };
}

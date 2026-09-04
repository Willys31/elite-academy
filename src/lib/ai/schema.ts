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

export interface LeconGeneree {
  title: string;
  text: string;
  estimated_minutes: number | null;
  quiz: QuizGenere | null;
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
 * Extrait l'objet JSON d'une réponse LLM, en tolérant les balises
 * de code et le texte parasite avant/après.
 */
export function extraireJson(texte: string): unknown | null {
  const nettoye = texte
    .replace(/```json/gi, "```")
    .replace(/```/g, "")
    .trim();

  // Essai direct.
  try {
    return JSON.parse(nettoye);
  } catch {
    // Repli : premier « { » jusqu'au dernier « } ».
    const debut = nettoye.indexOf("{");
    const fin = nettoye.lastIndexOf("}");
    if (debut === -1 || fin <= debut) return null;
    try {
      return JSON.parse(nettoye.slice(debut, fin + 1));
    } catch {
      return null;
    }
  }
}

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

/**
 * Valide et normalise le résultat brut du LLM.
 * Rejette si les éléments indispensables manquent (titre, au moins
 * une compétence, au moins un module avec au moins une leçon rédigée).
 */
export function validerResultat(brut: unknown): Analyse {
  if (brut === null || typeof brut !== "object") {
    return { ok: false, erreur: "La réponse de l'IA n'est pas un objet JSON valide." };
  }
  const r = brut as Record<string, unknown>;

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
          return {
            title: texteOuVide(ll.title),
            text: texteOuVide(ll.text),
            estimated_minutes: nombreOuNull(ll.estimated_minutes),
            quiz: validerQuiz(ll.quiz),
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
      warnings: tableau(r.warnings).map(texteOuVide).filter(Boolean).slice(0, 20),
      validation_required:
        typeof r.validation_required === "boolean" ? r.validation_required : true,
    },
  };
}

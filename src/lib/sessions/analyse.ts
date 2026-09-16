/**
 * Analyse pédagogique d'une session (note taker IA) – logique pure.
 *
 * Addendum Sessions hybrides §7 : résumé, points clés, mots-clés,
 * interventions typées, insights (part de parole du formateur, taux de
 * participation, recommandations). Le JSON du LLM est validé et
 * normalisé ici, comme `validerResultat` pour les plans de formation.
 */

import type { StatLocuteur } from "@/lib/sessions/tldv";
import type { FeedbackSession, ResultatPresence } from "@/lib/sessions/presence";

export type TypeIntervention = "question" | "answer" | "remark";
export const TYPE_INTERVENTION_LABELS: Record<TypeIntervention, string> = {
  question: "Question",
  answer: "Réponse",
  remark: "Remarque",
};

export interface InterventionAnalysee {
  speaker: string;
  start_seconds: number | null;
  end_seconds: number | null;
  type: TypeIntervention;
  snippet: string;
  quality_score: number | null;
}

export interface InsightsSession {
  trainer_talk_ratio: number | null;
  participation_rate: number | null;
  recommendations_trainer: string[];
  recommendations_learners: string[];
  warnings: string[];
}

export interface AnalyseSession {
  summary: string;
  key_points: string[];
  keywords: string[];
  interventions: InterventionAnalysee[];
  insights: InsightsSession;
}

export type ResultatAnalyse = { ok: true; resultat: AnalyseSession } | { ok: false; erreur: string };

const LIMITES = { keyPoints: 15, keywords: 20, interventions: 200, recommandations: 8, warnings: 10 };

function texte(v: unknown, max = 4000): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

function listeTextes(v: unknown, max: number, longueurMax = 300): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => texte(x, longueurMax)).filter(Boolean).slice(0, max);
}

function ratio(v: unknown): number | null {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  // Tolère 0–1 comme 0–100.
  const r = v > 1 ? v / 100 : v;
  return Math.min(1, Math.max(0, Math.round(r * 100) / 100));
}

function secondesOuNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.round(v) : null;
}

export function validerAnalyseSession(brut: unknown): ResultatAnalyse {
  if (!brut || typeof brut !== "object") {
    return { ok: false, erreur: "La réponse de l'IA n'est pas un objet JSON exploitable." };
  }
  const o = brut as Record<string, unknown>;
  const summary = texte(o.summary ?? o.resume, 6000);
  if (summary.length < 20) {
    return { ok: false, erreur: "L'analyse ne contient pas de résumé exploitable." };
  }

  const interventions: InterventionAnalysee[] = [];
  if (Array.isArray(o.interventions)) {
    for (const i of o.interventions.slice(0, LIMITES.interventions)) {
      if (!i || typeof i !== "object") continue;
      const x = i as Record<string, unknown>;
      const speaker = texte(x.speaker, 80);
      const snippet = texte(x.snippet ?? x.text, 500);
      if (!speaker || !snippet) continue;
      const type = x.type === "question" || x.type === "answer" ? x.type : "remark";
      const q = typeof x.quality_score === "number" ? Math.round(x.quality_score) : null;
      interventions.push({
        speaker,
        start_seconds: secondesOuNull(x.start_seconds ?? x.start),
        end_seconds: secondesOuNull(x.end_seconds ?? x.end),
        type,
        snippet,
        quality_score: q !== null && q >= 1 && q <= 5 ? q : null,
      });
    }
  }

  const ins = (o.insights && typeof o.insights === "object" ? o.insights : {}) as Record<string, unknown>;
  return {
    ok: true,
    resultat: {
      summary,
      key_points: listeTextes(o.key_points ?? o.points_cles, LIMITES.keyPoints),
      keywords: listeTextes(o.keywords ?? o.mots_cles, LIMITES.keywords, 40).map((k) => k.toLowerCase()),
      interventions,
      insights: {
        trainer_talk_ratio: ratio(ins.trainer_talk_ratio),
        participation_rate: ratio(ins.participation_rate),
        recommendations_trainer: listeTextes(ins.recommendations_trainer, LIMITES.recommandations),
        recommendations_learners: listeTextes(ins.recommendations_learners, LIMITES.recommandations),
        warnings: listeTextes(ins.warnings ?? o.warnings, LIMITES.warnings),
      },
    },
  };
}

/** Seuils de qualité de l'addendum §7.2. */
export const SEUILS_QUALITE = {
  participation: 0.7,
  formateurMin: 0.5,
  formateurMax: 0.7,
  reussite: 0.8,
  feedback: 4,
} as const;

export interface IndicateurQualite {
  libelle: string;
  valeur: string;
  ok: boolean | null;
  cible: string;
}

/**
 * Tableau d'indicateurs du bilan, avec verdict par rapport aux seuils.
 * `null` quand la donnée manque (pas de transcription, pas d'avis).
 */
export function indicateursQualite(params: {
  tauxParticipation: number | null;
  partFormateur: number | null;
  tauxReussite: number | null;
  feedbackMoyen: number | null;
}): IndicateurQualite[] {
  const pct = (v: number | null) => (v === null ? "—" : `${Math.round(v * 100)} %`);
  return [
    {
      libelle: "Taux de participation",
      valeur: pct(params.tauxParticipation),
      ok: params.tauxParticipation === null ? null : params.tauxParticipation >= SEUILS_QUALITE.participation,
      cible: "≥ 70 %",
    },
    {
      libelle: "Part de parole du formateur",
      valeur: pct(params.partFormateur),
      ok:
        params.partFormateur === null
          ? null
          : params.partFormateur >= SEUILS_QUALITE.formateurMin && params.partFormateur <= SEUILS_QUALITE.formateurMax,
      cible: "50 à 70 %",
    },
    {
      libelle: "Taux de réussite aux activités",
      valeur: pct(params.tauxReussite),
      ok: params.tauxReussite === null ? null : params.tauxReussite >= SEUILS_QUALITE.reussite,
      cible: "≥ 80 %",
    },
    {
      libelle: "Avis des apprenants",
      valeur: params.feedbackMoyen === null ? "—" : `${params.feedbackMoyen}/5`,
      ok: params.feedbackMoyen === null ? null : params.feedbackMoyen >= SEUILS_QUALITE.feedback,
      cible: "≥ 4/5",
    },
  ];
}

/** Part de parole du formateur, à partir des statistiques par locuteur. */
export function partFormateur(stats: StatLocuteur[], locuteursFormateur: Set<string>): number | null {
  const total = stats.reduce((s, l) => s + l.nbMots, 0);
  if (total === 0) return null;
  const formateur = stats.filter((l) => locuteursFormateur.has(l.locuteur)).reduce((s, l) => s + l.nbMots, 0);
  return Math.round((formateur / total) * 100) / 100;
}

export interface LigneBilanParticipant {
  nom: string;
  presence: ResultatPresence | null;
  nbReponses: number;
  scoreMoyen: number | null;
}

/** Export CSV du bilan (séparateur point-virgule, compatible tableur français). */
export function bilanEnCsv(params: {
  titre: string;
  participants: LigneBilanParticipant[];
  feedback: FeedbackSession[];
}): string {
  const echapper = (v: string | number | null | undefined) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lignes: string[] = [
    ["Session", params.titre].map(echapper).join(";"),
    "",
    ["Participant", "Statut", "Ponctualité", "Durée (min)", "XP", "Réponses", "Score moyen (%)"].join(";"),
    ...params.participants.map((p) =>
      [
        p.nom,
        p.presence?.statut ?? "",
        p.presence?.ponctualite ?? "",
        p.presence ? Math.round(p.presence.dureeSecondes / 60) : "",
        p.presence?.xp.total ?? "",
        p.nbReponses,
        p.scoreMoyen ?? "",
      ]
        .map(echapper)
        .join(";")
    ),
    "",
    ["Avis", "Satisfaction", "Clarté", "Utilité"].join(";"),
    ...params.feedback.map((f, i) =>
      [`Avis ${i + 1}`, f.satisfaction_score, f.clarity_score, f.usefulness_score].map(echapper).join(";")
    ),
  ];
  return `﻿${lignes.join("\r\n")}\r\n`;
}

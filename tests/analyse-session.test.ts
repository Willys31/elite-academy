import { describe, expect, it } from "vitest";
import {
  bilanEnCsv,
  indicateursQualite,
  partFormateur,
  validerAnalyseSession,
} from "@/lib/sessions/analyse";

describe("validerAnalyseSession", () => {
  it("normalise une réponse complète", () => {
    const r = validerAnalyseSession({
      summary: "La session a couvert la gestion des réclamations avec deux cas pratiques.",
      key_points: ["Écoute active", "", "Geste commercial"],
      keywords: ["Réclamation", "VIP"],
      interventions: [
        { speaker: "Awa", start_seconds: 12.4, end_seconds: 20, type: "question", snippet: "Comment…", quality_score: 4.4 },
        { speaker: "", snippet: "ignoré" },
        { speaker: "F", snippet: "ok", type: "autre", quality_score: 9 },
      ],
      insights: { trainer_talk_ratio: 72, participation_rate: 0.6, recommendations_trainer: ["Laisser plus de place"], warnings: [] },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.resultat.key_points).toEqual(["Écoute active", "Geste commercial"]);
    expect(r.resultat.keywords).toEqual(["réclamation", "vip"]);
    expect(r.resultat.interventions).toHaveLength(2);
    expect(r.resultat.interventions[0]).toMatchObject({ start_seconds: 12, type: "question", quality_score: 4 });
    expect(r.resultat.interventions[1]).toMatchObject({ type: "remark", quality_score: null });
    expect(r.resultat.insights.trainer_talk_ratio).toBe(0.72);
    expect(r.resultat.insights.participation_rate).toBe(0.6);
  });

  it("refuse sans résumé", () => {
    expect(validerAnalyseSession({ summary: "court" }).ok).toBe(false);
    expect(validerAnalyseSession(null).ok).toBe(false);
  });
});

describe("indicateursQualite / partFormateur", () => {
  it("compare aux seuils et tolère l'absence de donnée", () => {
    const ind = indicateursQualite({ tauxParticipation: 0.75, partFormateur: 0.8, tauxReussite: null, feedbackMoyen: 4.2 });
    expect(ind.map((i) => i.ok)).toEqual([true, false, null, true]);
    expect(ind[2].valeur).toBe("—");
  });

  it("calcule la part de parole du formateur", () => {
    const stats = [
      { locuteur: "Marie", nbInterventions: 3, nbMots: 60, partMots: 60 },
      { locuteur: "Awa", nbInterventions: 2, nbMots: 40, partMots: 40 },
    ];
    expect(partFormateur(stats, new Set(["Marie"]))).toBe(0.6);
    expect(partFormateur([], new Set())).toBeNull();
  });
});

describe("bilanEnCsv", () => {
  it("produit un CSV point-virgule avec échappement", () => {
    const csv = bilanEnCsv({
      titre: 'Atelier "conflits"',
      participants: [
        {
          nom: "Awa; Koné",
          presence: {
            statut: "present", ponctualite: "on_time", dureeSecondes: 3600, taux: 1, retardSecondes: 0, departAnticipe: false,
            xp: { presence: 20, ponctualite: 10, penalite: 0, total: 30 },
          },
          nbReponses: 2,
          scoreMoyen: 85,
        },
      ],
      feedback: [{ satisfaction_score: 5, clarity_score: 4, usefulness_score: null }],
    });
    expect(csv.startsWith("﻿Session;")).toBe(true);
    expect(csv).toContain('"Atelier ""conflits"""');
    expect(csv).toContain('"Awa; Koné";present;on_time;60;30;2;85');
    expect(csv).toContain("Avis 1;5;4;");
  });
});

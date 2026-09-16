import { describe, expect, it } from "vitest";
import {
  normaliserChargeTldv,
  parserTranscriptTexte,
  rapprocherLocuteurs,
  reconstituerTexte,
  statistiquesLocuteurs,
} from "@/lib/sessions/tldv";

describe("normaliserChargeTldv", () => {
  it("accepte un texte brut avec identifiant de réunion", () => {
    const c = normaliserChargeTldv({ meeting_id: "m1", transcript: "Bonjour à tous." });
    expect(c).toMatchObject({ meetingId: "m1", transcriptId: "meeting:m1", texte: "Bonjour à tous.", segments: [] });
  });

  it("accepte des segments et reconstitue le texte", () => {
    const c = normaliserChargeTldv({
      meeting_id: "m2",
      transcript_id: "t2",
      segments: [
        { speaker: "Awa", start_time: 0, end_time: 4, text: "Bonjour." },
        { speaker: "Koffi", start_time: 4, end_time: 9, text: "Une question ?" },
      ],
    });
    expect(c?.transcriptId).toBe("t2");
    expect(c?.segments).toHaveLength(2);
    expect(c?.texte).toBe("Awa : Bonjour.\nKoffi : Une question ?");
  });

  it("accepte la forme imbriquée meeting/transcript.data", () => {
    const c = normaliserChargeTldv({
      meeting: { id: "m3", name: "Atelier" },
      transcript: { id: "t3", data: [{ speaker_name: "Formateur", start: "1.5", end: "3", content: "Allons-y" }] },
    });
    expect(c).toMatchObject({ meetingId: "m3", transcriptId: "t3", titre: "Atelier" });
    expect(c?.segments[0]).toEqual({ locuteur: "Formateur", debut: 1.5, fin: 3, texte: "Allons-y" });
  });

  it("rejette une charge sans réunion ou sans texte", () => {
    expect(normaliserChargeTldv({ transcript: "x" })).toBeNull();
    expect(normaliserChargeTldv({ meeting_id: "m" })).toBeNull();
    expect(normaliserChargeTldv("texte")).toBeNull();
  });
});

describe("parserTranscriptTexte", () => {
  it("lit les trois formats de ligne et rattache les continuations", () => {
    const s = parserTranscriptTexte(
      "[00:01:05] Awa Koné : Bonjour tout le monde.\nsuite de la phrase\nKoffi (01:30): J'ai une question.\nFormateur : Allez-y."
    );
    expect(s).toHaveLength(3);
    expect(s[0]).toMatchObject({ locuteur: "Awa Koné", debut: 65, fin: 90, texte: "Bonjour tout le monde. suite de la phrase" });
    expect(s[1]).toMatchObject({ locuteur: "Koffi", debut: 90, fin: null });
    expect(s[2]).toMatchObject({ locuteur: "Formateur", debut: null });
  });

  it("met les lignes orphelines sur « Inconnu »", () => {
    expect(parserTranscriptTexte("juste du texte")[0]).toMatchObject({ locuteur: "Inconnu" });
  });

  it("reconstitue un texte lisible", () => {
    expect(reconstituerTexte([{ locuteur: "A", debut: null, fin: null, texte: "x" }])).toBe("A : x");
  });
});

describe("statistiquesLocuteurs", () => {
  it("compte interventions et part de parole en mots", () => {
    const stats = statistiquesLocuteurs([
      { locuteur: "F", debut: null, fin: null, texte: "un deux trois quatre cinq six" },
      { locuteur: "A", debut: null, fin: null, texte: "sept huit" },
      { locuteur: "F", debut: null, fin: null, texte: "neuf dix" },
    ]);
    expect(stats[0]).toEqual({ locuteur: "F", nbInterventions: 2, nbMots: 8, partMots: 80 });
    expect(stats[1].partMots).toBe(20);
  });
});

describe("rapprocherLocuteurs", () => {
  const formateur = { userId: "f", fullName: "Marie Dupont" };
  const participants = [
    { userId: "a", fullName: "Awa Koné" },
    { userId: "b", fullName: "Koffi N'Guessan" },
    { userId: "c", fullName: "Koffi Brou" },
  ];

  it("reconnaît nom complet, prénom unique, étiquette Formateur ; laisse l'ambigu", () => {
    const r = rapprocherLocuteurs(["awa kone", "Koffi", "Formateur", "Koffi Brou", "Inconnu"], participants, formateur);
    expect(r).toEqual([
      { locuteur: "awa kone", userId: "a", type: "learner" },
      { locuteur: "Koffi", userId: null, type: "unknown" },
      { locuteur: "Formateur", userId: "f", type: "trainer" },
      { locuteur: "Koffi Brou", userId: "c", type: "learner" },
      { locuteur: "Inconnu", userId: null, type: "unknown" },
    ]);
  });

  it("reconnaît le formateur par son nom", () => {
    expect(rapprocherLocuteurs(["Marie"], participants, formateur)[0]).toMatchObject({ userId: "f", type: "trainer" });
  });
});

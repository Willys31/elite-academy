import { describe, expect, it } from "vitest";
import {
  activitesARevoir,
  dernieresTentatives,
  lireTentative,
  questionsARevoir,
  type TentativeBrute,
} from "@/lib/courses/revision";

function tentative(
  activityId: string,
  horodatage: string | null,
  details: Array<[string, boolean]>
): TentativeBrute {
  return {
    activityId,
    score: null,
    horodatage,
    details: details.map(([questionId, correcte]) => ({
      questionId,
      reponseDonnee: correcte ? 1 : 0,
      correcte,
      bonneReponse: 1,
      explication: null,
    })),
  };
}

describe("dernieresTentatives", () => {
  it("ne garde que la tentative la plus récente de chaque activité", () => {
    const t = dernieresTentatives([
      tentative("a", "2026-01-01T10:00:00Z", [["q1", false]]),
      tentative("a", "2026-02-01T10:00:00Z", [["q1", true]]),
      tentative("b", "2026-01-15T10:00:00Z", [["q2", false]]),
    ]);
    expect(t.size).toBe(2);
    expect(t.get("a")?.horodatage).toBe("2026-02-01T10:00:00Z");
  });

  it("préfère toujours une tentative datée à une tentative sans date", () => {
    const t = dernieresTentatives([
      tentative("a", null, [["q1", false]]),
      tentative("a", "2026-01-01T10:00:00Z", [["q1", true]]),
    ]);
    expect(t.get("a")?.horodatage).toBe("2026-01-01T10:00:00Z");
  });

  it("garde la tentative sans date quand c'est la seule", () => {
    const t = dernieresTentatives([tentative("a", null, [["q1", false]])]);
    expect(t.size).toBe(1);
  });
});

describe("questionsARevoir", () => {
  it("retient les questions ratées à la dernière tentative", () => {
    const q = questionsARevoir([
      tentative("a", "2026-01-01T10:00:00Z", [
        ["q1", false],
        ["q2", true],
      ]),
    ]);
    expect(q.map((x) => x.questionId)).toEqual(["q1"]);
  });

  it("oublie une question ratée autrefois puis réussie depuis", () => {
    const q = questionsARevoir([
      tentative("a", "2026-01-01T10:00:00Z", [["q1", false]]),
      tentative("a", "2026-03-01T10:00:00Z", [["q1", true]]),
    ]);
    expect(q).toEqual([]);
  });

  it("ressort une question ratée à la dernière tentative même après une réussite", () => {
    // C'est la différence assumée avec le calcul de maîtrise, qui retient
    // le meilleur score : réviser porte sur l'état actuel des connaissances.
    const q = questionsARevoir([
      tentative("a", "2026-01-01T10:00:00Z", [["q1", true]]),
      tentative("a", "2026-03-01T10:00:00Z", [["q1", false]]),
    ]);
    expect(q.map((x) => x.questionId)).toEqual(["q1"]);
  });

  it("compte une question sans réponse comme à revoir", () => {
    const q = questionsARevoir([
      {
        activityId: "a",
        score: 0,
        horodatage: "2026-01-01T10:00:00Z",
        details: [
          {
            questionId: "q1",
            reponseDonnee: null,
            correcte: false,
            bonneReponse: 2,
            explication: null,
          },
        ],
      },
    ]);
    expect(q).toHaveLength(1);
    expect(q[0].reponseDonnee).toBeNull();
  });

  it("ne renvoie rien quand tout est réussi", () => {
    expect(
      questionsARevoir([tentative("a", "2026-01-01T10:00:00Z", [["q1", true]])])
    ).toEqual([]);
  });
});

describe("activitesARevoir", () => {
  it("dédoublonne les activités", () => {
    const ids = activitesARevoir([
      tentative("a", "2026-01-01T10:00:00Z", [
        ["q1", false],
        ["q2", false],
      ]),
      tentative("b", "2026-01-01T10:00:00Z", [["q3", true]]),
    ]);
    expect(ids).toEqual(["a"]);
  });
});

describe("lireTentative", () => {
  it("lit une ligne complète venue de la base", () => {
    const t = lireTentative({
      activity_id: "a",
      score: "80",
      submitted_at: "2026-01-01T10:00:00Z",
      feedback: {
        scorePourcent: 80,
        details: [
          {
            questionId: "q1",
            reponseDonnee: 2,
            correcte: false,
            bonneReponse: 0,
            explication: "Parce que.",
          },
        ],
      },
    });
    expect(t.score).toBe(80);
    expect(t.details[0].explication).toBe("Parce que.");
  });

  it("ignore un feedback absent ou mal formé sans casser l'écran", () => {
    expect(lireTentative({ activity_id: "a", score: null }).details).toEqual([]);
    expect(
      lireTentative({ activity_id: "a", score: null, feedback: "n'importe quoi" })
        .details
    ).toEqual([]);
    expect(
      lireTentative({
        activity_id: "a",
        score: null,
        feedback: { details: [{ pasDeQuestionId: true }, null, 42] },
      }).details
    ).toEqual([]);
  });

  it("retombe sur la date de début quand la soumission manque", () => {
    const t = lireTentative({
      activity_id: "a",
      score: null,
      started_at: "2026-01-01T09:00:00Z",
    });
    expect(t.horodatage).toBe("2026-01-01T09:00:00Z");
  });
});

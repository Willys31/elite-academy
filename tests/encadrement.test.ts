import { describe, expect, it } from "vitest";
import {
  formationsEncadrees,
  synthetiserEncadrement,
  type InscriptionEncadree,
} from "@/lib/profil/encadrement";

describe("formationsEncadrees", () => {
  it("réunit les trois rattachements", () => {
    expect(
      formationsEncadrees({
        conception: ["c-1"],
        affectation: ["c-2"],
        session: ["c-3"],
      }).sort()
    ).toEqual(["c-1", "c-2", "c-3"]);
  });

  it("ne compte qu'une fois une formation à la fois conçue et animée", () => {
    // Le cas ordinaire d'un formateur : il crée sa formation puis
    // l'anime. Deux faits, une seule formation.
    expect(
      formationsEncadrees({ conception: ["c-1"], session: ["c-1", "c-2"] }).sort()
    ).toEqual(["c-1", "c-2"]);
  });

  it("ignore les identifiants vides", () => {
    // Une session sans formation rattachée arrive avec une chaîne vide.
    expect(formationsEncadrees({ session: ["", "c-1"] })).toEqual(["c-1"]);
  });

  it("renvoie une liste vide quand rien n'est rattaché", () => {
    expect(formationsEncadrees({})).toEqual([]);
  });
});

describe("synthetiserEncadrement", () => {
  const INSCRIPTIONS: InscriptionEncadree[] = [
    { course_id: "c-1", user_id: "u-awa", status: "active" },
    { course_id: "c-2", user_id: "u-awa", status: "completed" },
    { course_id: "c-1", user_id: "u-ibrahim", status: "active" },
    { course_id: "c-1", user_id: "u-zoe", status: "withdrawn" },
    { course_id: "c-99", user_id: "u-autre", status: "active" },
  ];

  const base = {
    formations: ["c-1", "c-2"],
    sessions: 4,
    inscriptions: INSCRIPTIONS,
    certificatsDelivres: 3,
  };

  it("compte les apprenants DISTINCTS, pas les inscriptions", () => {
    // Awa est inscrite aux deux formations : une personne encadrée.
    expect(synthetiserEncadrement(base).apprenants).toBe(2);
  });

  it("exclut un apprenant désinscrit", () => {
    // Zoé s'est retirée : elle n'est plus encadrée.
    const sansZoe = synthetiserEncadrement(base).apprenants;
    expect(sansZoe).toBe(2);
  });

  it("ignore les inscriptions hors du périmètre encadré", () => {
    // c-99 n'appartient pas à cette personne.
    expect(synthetiserEncadrement(base).apprenants).not.toBe(3);
  });

  it("reprend les formations, sessions et certificats tels quels", () => {
    expect(synthetiserEncadrement(base)).toEqual({
      formations: 2,
      sessions: 4,
      apprenants: 2,
      certificats: 3,
    });
  });

  it("dédoublonne le périmètre reçu", () => {
    const s = synthetiserEncadrement({ ...base, formations: ["c-1", "c-1", "c-2"] });
    expect(s.formations).toBe(2);
  });

  it("tient un encadrement encore vide", () => {
    expect(
      synthetiserEncadrement({
        formations: [],
        sessions: 0,
        inscriptions: [],
        certificatsDelivres: 0,
      })
    ).toEqual({ formations: 0, sessions: 0, apprenants: 0, certificats: 0 });
  });
});

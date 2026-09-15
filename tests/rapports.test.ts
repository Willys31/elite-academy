import { describe, expect, it } from "vitest";
import {
  parApprenant,
  parFormation,
  synthetiserOrganisation,
  type CertificatBrut,
  type InscriptionBrute,
} from "@/lib/rapports/rapports";

const TITRES = new Map([
  ["c-vente", "Techniques de vente"],
  ["c-secu", "Sécurité en agence"],
]);

const NOMS = new Map([
  ["u-awa", "Awa Koné"],
  ["u-ibrahim", "Ibrahim Ba"],
]);

const INSCRIPTIONS: InscriptionBrute[] = [
  { user_id: "u-awa", course_id: "c-vente", status: "completed" },
  { user_id: "u-awa", course_id: "c-secu", status: "active" },
  { user_id: "u-ibrahim", course_id: "c-vente", status: "active" },
  { user_id: "u-ibrahim", course_id: "c-secu", status: "withdrawn" },
];

const CERTIFICATS: CertificatBrut[] = [
  { user_id: "u-awa", course_id: "c-vente", status: "valid" },
  { user_id: "u-ibrahim", course_id: "c-vente", status: "revoked" },
];

describe("synthetiserOrganisation", () => {
  it("compte les apprenants distincts, désinscriptions comprises", () => {
    const s = synthetiserOrganisation(INSCRIPTIONS, CERTIFICATS);
    expect(s.apprenants).toBe(2);
  });

  it("sort les désinscriptions du dénominateur et les compte à part", () => {
    const s = synthetiserOrganisation(INSCRIPTIONS, CERTIFICATS);
    expect(s.inscriptions).toBe(3);
    expect(s.desinscriptions).toBe(1);
    // 1 achevée sur 3 retenues, et non sur 4.
    expect(s.tauxAchevement).toBe(33);
  });

  it("ne compte pas un certificat révoqué", () => {
    expect(synthetiserOrganisation(INSCRIPTIONS, CERTIFICATS).certificats).toBe(1);
  });

  it("renvoie un taux nul plutôt que zéro quand rien n'est mesurable", () => {
    // Zéro et « pas mesurable » ne veulent pas dire la même chose :
    // afficher 0 % laisserait croire à un échec général.
    const s = synthetiserOrganisation(
      [{ user_id: "u-awa", course_id: "c-vente", status: "withdrawn" }],
      []
    );
    expect(s.tauxAchevement).toBeNull();
    expect(s.inscriptions).toBe(0);
  });

  it("gère une organisation sans aucune inscription", () => {
    expect(synthetiserOrganisation([], [])).toEqual({
      apprenants: 0,
      inscriptions: 0,
      achevees: 0,
      desinscriptions: 0,
      certificats: 0,
      tauxAchevement: null,
    });
  });
});

describe("parFormation", () => {
  it("classe du taux le plus faible au plus fort", () => {
    const r = parFormation(INSCRIPTIONS, CERTIFICATS, TITRES);
    expect(r.map((l) => l.titre)).toEqual([
      "Sécurité en agence", // 0 % sur 1 retenue
      "Techniques de vente", // 50 % sur 2
    ]);
  });

  it("détaille inscrits, en cours, achevées et désinscriptions", () => {
    const secu = parFormation(INSCRIPTIONS, CERTIFICATS, TITRES).find(
      (l) => l.courseId === "c-secu"
    );
    expect(secu).toMatchObject({
      inscrits: 1,
      enCours: 1,
      achevees: 0,
      desinscriptions: 1,
      certificats: 0,
      tauxAchevement: 0,
    });
  });

  it("nomme une formation absente du catalogue au lieu de l'effacer", () => {
    const r = parFormation(
      [{ user_id: "u-awa", course_id: "c-disparue", status: "active" }],
      [],
      TITRES
    );
    expect(r[0].titre).toBe("Formation retirée du catalogue");
  });

  it("place en dernier une formation sans inscription mesurable", () => {
    const r = parFormation(
      [
        { user_id: "u-awa", course_id: "c-vente", status: "active" },
        { user_id: "u-ibrahim", course_id: "c-secu", status: "withdrawn" },
      ],
      [],
      TITRES
    );
    expect(r.map((l) => l.courseId)).toEqual(["c-vente", "c-secu"]);
    expect(r[1].tauxAchevement).toBeNull();
  });
});

describe("parApprenant", () => {
  it("classe du taux le plus faible au plus fort", () => {
    const r = parApprenant(INSCRIPTIONS, CERTIFICATS, NOMS);
    expect(r.map((l) => l.nom)).toEqual([
      "Ibrahim Ba", // 0 % sur 1 retenue
      "Awa Koné", // 50 % sur 2
    ]);
  });

  it("ne compte pas les désinscriptions dans les inscriptions de l'apprenant", () => {
    const ibrahim = parApprenant(INSCRIPTIONS, CERTIFICATS, NOMS).find(
      (l) => l.userId === "u-ibrahim"
    );
    expect(ibrahim?.inscriptions).toBe(1);
    expect(ibrahim?.certificats).toBe(0); // le sien est révoqué
  });

  it("départage deux taux égaux par ordre alphabétique", () => {
    const r = parApprenant(
      [
        { user_id: "u-ibrahim", course_id: "c-vente", status: "active" },
        { user_id: "u-awa", course_id: "c-secu", status: "active" },
      ],
      [],
      NOMS
    );
    expect(r.map((l) => l.nom)).toEqual(["Awa Koné", "Ibrahim Ba"]);
  });
});

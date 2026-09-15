import { describe, expect, it } from "vitest";
import {
  construireAnnuaire,
  filtrerAnnuaire,
  normaliser,
  synthetiserAnnuaire,
  type AdhesionBrute,
  type OrganisationBrute,
  type ProfilBrut,
} from "@/lib/utilisateurs/annuaire";

const ORGS: OrganisationBrute[] = [
  { id: "o-elite", name: "Elite Experience", type: "elite_experience" },
  { id: "o-banque", name: "Banque Atlantique", type: "entreprise" },
  { id: "o-ecole", name: "École Supérieure", type: "ecole" },
];

const PROFILS: ProfilBrut[] = [
  { id: "u-kone", full_name: "Awa Koné", email: "awa@banque.ci", status: "active" },
  { id: "u-yao", full_name: "Wilfried Yao", email: "w.yao@elite.ci", status: "active" },
  { id: "u-ba", full_name: "Ibrahim Ba", email: "i.ba@ecole.ci", status: "suspended" },
  { id: "u-neuf", full_name: "", email: "zoe@nouveau.ci", status: "active" },
];

const ADHESIONS: AdhesionBrute[] = [
  { user_id: "u-kone", organization_id: "o-banque", role: "learner", status: "active" },
  { user_id: "u-yao", organization_id: "o-elite", role: "admin", status: "active" },
  { user_id: "u-yao", organization_id: "o-banque", role: "trainer", status: "active" },
  { user_id: "u-ba", organization_id: "o-ecole", role: "manager", status: "suspended" },
];

const annuaire = () => construireAnnuaire(PROFILS, ADHESIONS, ORGS);

describe("normaliser", () => {
  it("ignore les accents et la casse", () => {
    expect(normaliser("Koné")).toBe("kone");
    expect(normaliser("  ÉCOLE  ")).toBe("ecole");
  });
});

describe("construireAnnuaire", () => {
  it("garde les comptes sans aucune adhésion", () => {
    const zoe = annuaire().find((l) => l.id === "u-neuf");
    expect(zoe).toBeDefined();
    expect(zoe?.adhesions).toEqual([]);
    expect(zoe?.orphelin).toBe(true);
  });

  it("marque orphelin un compte dont la seule adhésion est suspendue", () => {
    // Ibrahim a bien une adhésion, mais elle est suspendue : il
    // n'exerce aucun rôle, et c'est ce qui compte pour un administrateur.
    const ibrahim = annuaire().find((l) => l.id === "u-ba");
    expect(ibrahim?.adhesions).toHaveLength(1);
    expect(ibrahim?.roles).toEqual([]);
    expect(ibrahim?.orphelin).toBe(true);
  });

  it("classe les rôles du plus fort au plus faible, sans doublon", () => {
    const yao = annuaire().find((l) => l.id === "u-yao");
    expect(yao?.roles).toEqual(["admin", "trainer"]);
  });

  it("trie par nom, avec l'e-mail en repli quand le nom manque", () => {
    expect(annuaire().map((l) => l.nom || l.email)).toEqual([
      "Awa Koné",
      "Ibrahim Ba",
      "Wilfried Yao",
      "zoe@nouveau.ci",
    ]);
  });

  it("nomme explicitement une organisation que la RLS n'a pas laissé lire", () => {
    const lignes = construireAnnuaire(
      [PROFILS[0]],
      [{ user_id: "u-kone", organization_id: "o-inconnue", role: "learner", status: "active" }],
      ORGS
    );
    expect(lignes[0].adhesions[0].organisation).toBe("Organisation non accessible");
    // Le compte n'est pas orphelin pour autant : l'adhésion existe.
    expect(lignes[0].orphelin).toBe(false);
  });
});

describe("filtrerAnnuaire", () => {
  it("sans filtre, ne retire rien", () => {
    expect(filtrerAnnuaire(annuaire(), {})).toHaveLength(4);
  });

  it("cherche sans tenir compte des accents", () => {
    const r = filtrerAnnuaire(annuaire(), { recherche: "kone" });
    expect(r.map((l) => l.id)).toEqual(["u-kone"]);
  });

  it("cherche aussi dans l'e-mail", () => {
    const r = filtrerAnnuaire(annuaire(), { recherche: "@ecole.ci" });
    expect(r.map((l) => l.id)).toEqual(["u-ba"]);
  });

  it("ne retient au filtre de rôle que les adhésions actives", () => {
    // Ibrahim est « manager » sur une adhésion suspendue : il ne doit
    // pas ressortir, sinon l'administrateur croit à un responsable en poste.
    expect(filtrerAnnuaire(annuaire(), { role: "manager" })).toHaveLength(0);
    expect(filtrerAnnuaire(annuaire(), { role: "trainer" }).map((l) => l.id)).toEqual([
      "u-yao",
    ]);
  });

  it("filtre par organisation, adhésion suspendue comprise", () => {
    const r = filtrerAnnuaire(annuaire(), { organisation: "o-ecole" });
    expect(r.map((l) => l.id)).toEqual(["u-ba"]);
  });

  it("distingue compte suspendu et compte sans rattachement", () => {
    expect(filtrerAnnuaire(annuaire(), { statut: "suspendu" }).map((l) => l.id)).toEqual([
      "u-ba",
    ]);
    expect(filtrerAnnuaire(annuaire(), { statut: "orphelin" }).map((l) => l.id)).toEqual([
      "u-ba",
      "u-neuf",
    ]);
  });

  it("combine les filtres", () => {
    const r = filtrerAnnuaire(annuaire(), {
      recherche: "yao",
      organisation: "o-banque",
      role: "trainer",
    });
    expect(r.map((l) => l.id)).toEqual(["u-yao"]);
  });
});

describe("synthetiserAnnuaire", () => {
  it("compte les comptes, les actifs, les orphelins et les organisations", () => {
    expect(synthetiserAnnuaire(annuaire())).toEqual({
      comptes: 4,
      actifs: 3,
      orphelins: 2,
      organisations: 3,
    });
  });

  it("ne compte qu'une fois une organisation partagée", () => {
    const s = synthetiserAnnuaire(
      construireAnnuaire(
        [PROFILS[0], PROFILS[1]],
        [
          { user_id: "u-kone", organization_id: "o-banque", role: "learner", status: "active" },
          { user_id: "u-yao", organization_id: "o-banque", role: "trainer", status: "active" },
        ],
        ORGS
      )
    );
    expect(s.organisations).toBe(1);
  });
});

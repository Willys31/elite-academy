import { describe, expect, it } from "vitest";
import type { Membership } from "@/lib/auth/roles";
import {
  organisationChoisie,
  organisationsAdministrees,
  peutAdministrerOrganisation,
  repartirParRole,
} from "@/lib/organisations/parametres";

const m = (
  organization_id: string,
  role: Membership["role"],
  name: string,
  type: NonNullable<Membership["organization"]>["type"] = "entreprise",
  status = "active"
): Membership => ({
  organization_id,
  role,
  status,
  organization: { id: organization_id, name, type },
});

const ELITE = m("o-elite", "admin", "Elite Experience", "elite_experience");
const ADMIN_BANQUE = m("o-banque", "admin", "Banque Atlantique");
const MANAGER_ECOLE = m("o-ecole", "manager", "École Supérieure", "ecole");
const TRAINER_BANQUE = m("o-banque", "trainer", "Banque Atlantique");

describe("peutAdministrerOrganisation", () => {
  it("accorde le droit à l'administrateur Elite Experience, partout", () => {
    expect(peutAdministrerOrganisation([ELITE], "o-inconnue")).toBe(true);
  });

  it("accorde le droit à l'administrateur de l'organisation", () => {
    expect(peutAdministrerOrganisation([ADMIN_BANQUE], "o-banque")).toBe(true);
  });

  it("refuse le droit sur une AUTRE organisation", () => {
    expect(peutAdministrerOrganisation([ADMIN_BANQUE], "o-ecole")).toBe(false);
  });

  it("refuse le droit au responsable d'organisation", () => {
    // Un manager gère les membres, pas l'organisation elle-même :
    // c'est ce que dit la politique organizations_update.
    expect(peutAdministrerOrganisation([MANAGER_ECOLE], "o-ecole")).toBe(false);
  });

  it("refuse le droit au formateur", () => {
    expect(peutAdministrerOrganisation([TRAINER_BANQUE], "o-banque")).toBe(false);
  });

  it("ignore une adhésion suspendue", () => {
    const suspendu = m("o-banque", "admin", "Banque Atlantique", "entreprise", "suspended");
    expect(peutAdministrerOrganisation([suspendu], "o-banque")).toBe(false);
  });
});

describe("organisationsAdministrees", () => {
  it("ne retient que les adhésions admin, triées par nom", () => {
    const r = organisationsAdministrees([ADMIN_BANQUE, ELITE, MANAGER_ECOLE]);
    expect(r.map((x) => x.organization?.name)).toEqual([
      "Banque Atlantique",
      "Elite Experience",
    ]);
  });

  it("renvoie une liste vide quand rien n'est administré", () => {
    expect(organisationsAdministrees([MANAGER_ECOLE, TRAINER_BANQUE])).toEqual([]);
  });
});

describe("organisationChoisie", () => {
  it("retient l'organisation demandée quand elle est administrée", () => {
    expect(organisationChoisie([ADMIN_BANQUE, ELITE], "o-elite")).toBe("o-elite");
  });

  it("ignore une organisation demandée mais non administrée", () => {
    // Un identifiant collé dans l'URL ne doit pas ouvrir un formulaire
    // d'édition que la base refusera ensuite d'enregistrer.
    expect(organisationChoisie([ADMIN_BANQUE], "o-ecole")).toBe("o-banque");
  });

  it("retombe sur la première organisation administrée", () => {
    expect(organisationChoisie([ADMIN_BANQUE, ELITE])).toBe("o-banque");
  });

  it("renvoie null quand l'utilisateur n'administre rien", () => {
    expect(organisationChoisie([MANAGER_ECOLE])).toBeNull();
  });
});

describe("repartirParRole", () => {
  it("compte les membres actifs par rôle, dans l'ordre hiérarchique", () => {
    expect(
      repartirParRole([
        { role: "learner", status: "active" },
        { role: "admin", status: "active" },
        { role: "learner", status: "active" },
        { role: "trainer", status: "active" },
      ])
    ).toEqual([
      { role: "admin", membres: 1 },
      { role: "trainer", membres: 1 },
      { role: "learner", membres: 2 },
    ]);
  });

  it("exclut les adhésions non actives", () => {
    expect(
      repartirParRole([
        { role: "trainer", status: "suspended" },
        { role: "learner", status: "active" },
      ])
    ).toEqual([{ role: "learner", membres: 1 }]);
  });

  it("n'affiche pas les rôles sans effectif", () => {
    expect(repartirParRole([{ role: "admin", status: "active" }])).toEqual([
      { role: "admin", membres: 1 },
    ]);
  });
});

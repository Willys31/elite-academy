import { describe, expect, it } from "vitest";
import {
  activeMemberships,
  canCreateOrganization,
  canManageMembers,
  hasAnyRole,
  isEliteAdmin,
  navigationFor,
  primaryRole,
  type Membership,
} from "@/lib/auth/roles";

const ORG_ELITE = "org-elite";
const ORG_A = "org-a";
const ORG_B = "org-b";

function membership(
  role: Membership["role"],
  organization_id = ORG_A,
  status = "active",
  orgType: NonNullable<Membership["organization"]>["type"] = "entreprise"
): Membership {
  return {
    organization_id,
    role,
    status,
    organization: { id: organization_id, name: "Test", type: orgType },
  };
}

const eliteAdmin = membership("admin", ORG_ELITE, "active", "elite_experience");

describe("activeMemberships", () => {
  it("ne conserve que les adhésions actives", () => {
    const list = [
      membership("learner"),
      membership("trainer", ORG_B, "suspended"),
    ];
    expect(activeMemberships(list)).toHaveLength(1);
    expect(activeMemberships(list)[0].role).toBe("learner");
  });

  it("retourne un tableau vide sans adhésion", () => {
    expect(activeMemberships([])).toEqual([]);
  });
});

describe("isEliteAdmin", () => {
  it("reconnaît l'administrateur Elite Experience", () => {
    expect(isEliteAdmin([eliteAdmin])).toBe(true);
  });

  it("refuse un admin d'une organisation ordinaire", () => {
    expect(isEliteAdmin([membership("admin")])).toBe(false);
  });

  it("refuse un membre Elite Experience non admin", () => {
    expect(
      isEliteAdmin([
        membership("trainer", ORG_ELITE, "active", "elite_experience"),
      ])
    ).toBe(false);
  });

  it("refuse une adhésion admin suspendue", () => {
    expect(
      isEliteAdmin([
        membership("admin", ORG_ELITE, "suspended", "elite_experience"),
      ])
    ).toBe(false);
  });
});

describe("primaryRole", () => {
  it("retourne learner par défaut", () => {
    expect(primaryRole([])).toBe("learner");
  });

  it("respecte la priorité admin > designer > trainer > manager > learner", () => {
    expect(primaryRole([membership("learner"), membership("trainer", ORG_B)])).toBe(
      "trainer"
    );
    expect(
      primaryRole([membership("manager"), membership("designer", ORG_B)])
    ).toBe("designer");
    expect(primaryRole([membership("learner"), eliteAdmin])).toBe("admin");
  });

  it("ignore les adhésions inactives", () => {
    expect(
      primaryRole([membership("admin", ORG_A, "archived"), membership("learner")])
    ).toBe("learner");
  });
});

describe("hasAnyRole", () => {
  it("détecte un rôle présent", () => {
    expect(hasAnyRole([membership("trainer")], ["trainer", "manager"])).toBe(true);
  });

  it("refuse un rôle absent ou inactif", () => {
    expect(hasAnyRole([membership("learner")], ["trainer"])).toBe(false);
    expect(
      hasAnyRole([membership("trainer", ORG_A, "suspended")], ["trainer"])
    ).toBe(false);
  });
});

describe("canCreateOrganization", () => {
  it("autorise uniquement l'admin Elite Experience", () => {
    expect(canCreateOrganization([eliteAdmin])).toBe(true);
    expect(canCreateOrganization([membership("admin")])).toBe(false);
    expect(canCreateOrganization([membership("manager")])).toBe(false);
    expect(canCreateOrganization([])).toBe(false);
  });
});

describe("canManageMembers", () => {
  it("autorise l'admin Elite Experience sur toute organisation", () => {
    expect(canManageMembers([eliteAdmin], ORG_B)).toBe(true);
  });

  it("autorise l'admin et le manager de l'organisation concernée", () => {
    expect(canManageMembers([membership("admin", ORG_A)], ORG_A)).toBe(true);
    expect(canManageMembers([membership("manager", ORG_A)], ORG_A)).toBe(true);
  });

  it("refuse sur une autre organisation", () => {
    expect(canManageMembers([membership("admin", ORG_A)], ORG_B)).toBe(false);
  });

  it("refuse les rôles trainer, designer et learner", () => {
    expect(canManageMembers([membership("trainer", ORG_A)], ORG_A)).toBe(false);
    expect(canManageMembers([membership("designer", ORG_A)], ORG_A)).toBe(false);
    expect(canManageMembers([membership("learner", ORG_A)], ORG_A)).toBe(false);
  });
});

describe("navigationFor", () => {
  it("fournit une navigation par rôle conforme à la spécification UX", () => {
    expect(navigationFor("learner").map((n) => n.label)).toContain(
      "Ma révision"
    );
    expect(navigationFor("trainer").map((n) => n.label)).toContain(
      "Mes sessions"
    );
    expect(navigationFor("admin").map((n) => n.label)).toContain("Validation");
    expect(navigationFor("manager").map((n) => n.label)).toContain("Rapports");
  });

  it("chaque élément possède un chemin absolu", () => {
    for (const role of ["admin", "designer", "trainer", "manager", "learner"] as const) {
      for (const item of navigationFor(role)) {
        expect(item.href.startsWith("/")).toBe(true);
      }
    }
  });
});

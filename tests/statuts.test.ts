import { describe, expect, it } from "vitest";
import type { Membership } from "@/lib/auth/roles";
import {
  availableTransitions,
  canCreateCourse,
  canManageCompetencies,
  canTransition,
  isContentEditable,
  organizationsForCourseCreation,
  slugify,
  transitionLabel,
} from "@/lib/courses/statuts";

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
const orgAdmin = membership("admin", ORG_A);
const designer = membership("designer", ORG_A);
const trainer = membership("trainer", ORG_A);
const learner = membership("learner", ORG_A);

describe("canTransition", () => {
  it("le concepteur peut soumettre un brouillon à validation", () => {
    expect(canTransition([designer], ORG_A, "draft", "review")).toBe(true);
  });

  it("le concepteur ne peut ni approuver ni publier", () => {
    expect(canTransition([designer], ORG_A, "review", "approved")).toBe(false);
    expect(canTransition([designer], ORG_A, "approved", "published")).toBe(false);
  });

  it("l'admin d'organisation approuve, publie et archive", () => {
    expect(canTransition([orgAdmin], ORG_A, "review", "approved")).toBe(true);
    expect(canTransition([orgAdmin], ORG_A, "approved", "published")).toBe(true);
    expect(canTransition([orgAdmin], ORG_A, "published", "archived")).toBe(true);
  });

  it("l'admin peut demander des corrections (review → draft)", () => {
    expect(canTransition([orgAdmin], ORG_A, "review", "draft")).toBe(true);
  });

  it("l'admin Elite Experience peut agir sur toute organisation", () => {
    expect(canTransition([eliteAdmin], ORG_B, "review", "approved")).toBe(true);
    expect(canTransition([eliteAdmin], ORG_B, "approved", "published")).toBe(true);
  });

  it("formateur et apprenant ne peuvent effectuer aucune transition", () => {
    expect(canTransition([trainer], ORG_A, "draft", "review")).toBe(false);
    expect(canTransition([learner], ORG_A, "draft", "review")).toBe(false);
  });

  it("les transitions inexistantes sont refusées", () => {
    expect(canTransition([orgAdmin], ORG_A, "draft", "published")).toBe(false);
    expect(canTransition([orgAdmin], ORG_A, "published", "draft")).toBe(false);
    expect(canTransition([eliteAdmin], ORG_A, "draft", "published")).toBe(false);
  });

  it("l'admin d'une autre organisation est refusé", () => {
    expect(canTransition([membership("admin", ORG_B)], ORG_A, "draft", "review")).toBe(false);
  });
});

describe("availableTransitions", () => {
  it("propose les bonnes actions au concepteur sur un brouillon", () => {
    expect(availableTransitions([designer], ORG_A, "draft")).toEqual(["review"]);
  });

  it("propose approbation et corrections à l'admin en review", () => {
    const t = availableTransitions([orgAdmin], ORG_A, "review");
    expect(t).toContain("approved");
    expect(t).toContain("draft");
  });

  it("ne propose rien à un apprenant", () => {
    expect(availableTransitions([learner], ORG_A, "draft")).toEqual([]);
  });
});

describe("isContentEditable", () => {
  it("seul le brouillon est modifiable", () => {
    expect(isContentEditable("draft")).toBe(true);
    for (const s of ["review", "approved", "published", "archived"] as const) {
      expect(isContentEditable(s)).toBe(false);
    }
  });
});

describe("canCreateCourse / organizationsForCourseCreation", () => {
  it("admin et concepteur de l'organisation peuvent créer", () => {
    expect(canCreateCourse([orgAdmin], ORG_A)).toBe(true);
    expect(canCreateCourse([designer], ORG_A)).toBe(true);
  });

  it("formateur, responsable et apprenant ne peuvent pas créer", () => {
    expect(canCreateCourse([trainer], ORG_A)).toBe(false);
    expect(canCreateCourse([membership("manager")], ORG_A)).toBe(false);
    expect(canCreateCourse([learner], ORG_A)).toBe(false);
  });

  it("l'admin Elite Experience peut créer partout", () => {
    expect(canCreateCourse([eliteAdmin], ORG_B)).toBe(true);
  });

  it("liste les organisations où la création est possible", () => {
    const list = organizationsForCourseCreation([designer, membership("learner", ORG_B)]);
    expect(list).toHaveLength(1);
    expect(list[0].organization_id).toBe(ORG_A);
  });
});

describe("canManageCompetencies", () => {
  it("compétences globales : Elite Experience uniquement", () => {
    expect(canManageCompetencies([eliteAdmin], null)).toBe(true);
    expect(canManageCompetencies([orgAdmin], null)).toBe(false);
  });

  it("compétences d'organisation : admin et concepteur", () => {
    expect(canManageCompetencies([orgAdmin], ORG_A)).toBe(true);
    expect(canManageCompetencies([designer], ORG_A)).toBe(true);
    expect(canManageCompetencies([trainer], ORG_A)).toBe(false);
    expect(canManageCompetencies([orgAdmin], ORG_B)).toBe(false);
  });
});

describe("slugify", () => {
  it("gère accents, espaces et caractères spéciaux", () => {
    expect(slugify("Gestion des conflits internes")).toBe("gestion-des-conflits-internes");
    expect(slugify("Éthique & conformité (Banque)")).toBe("ethique-conformite-banque");
  });

  it("ne retourne jamais une chaîne vide", () => {
    expect(slugify("!!!")).toBe("formation");
  });
});

describe("transitionLabel", () => {
  it("fournit des libellés français", () => {
    expect(transitionLabel("draft", "review")).toBe("Soumettre à validation");
    expect(transitionLabel("review", "approved")).toBe("Approuver");
    expect(transitionLabel("approved", "published")).toBe("Publier");
  });
});

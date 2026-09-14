import { describe, expect, it } from "vitest";
import {
  indexerAnimations,
  peutAffecterFormateurs,
  peutEtreAffecte,
  resoudreFormationsAnimees,
} from "@/lib/courses/affectations";

describe("resoudreFormationsAnimees", () => {
  it("réunit les trois sources sans doublon", () => {
    const r = resoudreFormationsAnimees({
      conception: ["c1"],
      affectation: ["c2"],
      session: ["c3"],
    });
    expect(r.map((x) => x.courseId).sort()).toEqual(["c1", "c2", "c3"]);
  });

  it("ne cite qu'une fois une formation présente dans plusieurs sources", () => {
    const r = resoudreFormationsAnimees({
      conception: ["c1"],
      affectation: ["c1"],
      session: ["c1"],
    });
    expect(r).toHaveLength(1);
    expect(r[0].origines).toEqual(["conception", "affectation", "session"]);
  });

  it("retient la conception comme origine dominante", () => {
    const r = resoudreFormationsAnimees({
      conception: ["c1"],
      session: ["c1"],
    });
    expect(r[0].origine).toBe("conception");
  });

  it("retient l'affectation devant la session", () => {
    const r = resoudreFormationsAnimees({
      affectation: ["c1"],
      session: ["c1"],
    });
    expect(r[0].origine).toBe("affectation");
  });

  it("ignore une session sans formation liée", () => {
    // `live_sessions.course_id` est facultatif : un atelier peut exister
    // sans formation. Il ne doit rien ajouter à cette liste.
    const r = resoudreFormationsAnimees({ session: ["", "c1"] });
    expect(r.map((x) => x.courseId)).toEqual(["c1"]);
  });

  it("ne renvoie rien quand aucune source n'est fournie", () => {
    expect(resoudreFormationsAnimees({})).toEqual([]);
    expect(
      resoudreFormationsAnimees({ conception: [], affectation: [], session: [] })
    ).toEqual([]);
  });

  it("dédoublonne à l'intérieur d'une même source", () => {
    // Deux sessions sur la même formation ne font pas deux formations.
    const r = resoudreFormationsAnimees({ session: ["c1", "c1"] });
    expect(r).toHaveLength(1);
    expect(r[0].origines).toEqual(["session"]);
  });
});

describe("indexerAnimations", () => {
  it("permet de retrouver l'origine d'une formation", () => {
    const index = indexerAnimations(
      resoudreFormationsAnimees({ affectation: ["c1"], session: ["c2"] })
    );
    expect(index.get("c1")?.origine).toBe("affectation");
    expect(index.get("c2")?.origine).toBe("session");
    expect(index.get("c3")).toBeUndefined();
  });
});

describe("peutAffecterFormateurs", () => {
  it("autorise l'administrateur et le responsable", () => {
    expect(peutAffecterFormateurs("admin", false)).toBe(true);
    expect(peutAffecterFormateurs("manager", false)).toBe(true);
  });

  it("refuse au formateur de s'auto-affecter", () => {
    expect(peutAffecterFormateurs("trainer", false)).toBe(false);
  });

  it("refuse au concepteur et à l'apprenant", () => {
    expect(peutAffecterFormateurs("designer", false)).toBe(false);
    expect(peutAffecterFormateurs("learner", false)).toBe(false);
  });

  it("autorise l'admin Elite Experience partout, même sans rôle local", () => {
    expect(peutAffecterFormateurs(null, true)).toBe(true);
  });
});

describe("peutEtreAffecte", () => {
  it("accepte formateur, concepteur et administrateur", () => {
    expect(peutEtreAffecte("trainer")).toBe(true);
    expect(peutEtreAffecte("designer")).toBe(true);
    expect(peutEtreAffecte("admin")).toBe(true);
  });

  it("écarte le responsable, qui pilote sans animer", () => {
    expect(peutEtreAffecte("manager")).toBe(false);
  });

  it("écarte l'apprenant", () => {
    expect(peutEtreAffecte("learner")).toBe(false);
  });
});

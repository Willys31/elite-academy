import { describe, expect, it } from "vitest";
import {
  etiquettePortee,
  lirePortee,
  PORTEE_PAR_DEFAUT,
  PORTEES,
  porteeExigeFormation,
  porteeValide,
  recommandationPortee,
} from "@/lib/partage/visibilite";

describe("porteeValide / lirePortee", () => {
  it("reconnaît les quatre portées et rejette le reste", () => {
    for (const p of PORTEES) expect(porteeValide(p)).toBe(true);
    expect(porteeValide("global")).toBe(false);
    expect(porteeValide(null)).toBe(false);
    expect(porteeValide(42)).toBe(false);
  });

  it("retombe sur Entreprise quand la valeur est absente ou inconnue", () => {
    expect(lirePortee(undefined)).toBe(PORTEE_PAR_DEFAUT);
    expect(lirePortee("n'importe quoi")).toBe("organization");
    expect(lirePortee("public")).toBe("public");
    expect(lirePortee(null, "group")).toBe("group");
  });
});

describe("règles d'interface", () => {
  it("seul le groupe exige une formation", () => {
    expect(porteeExigeFormation("group")).toBe(true);
    expect(porteeExigeFormation("organization")).toBe(false);
    expect(porteeExigeFormation("sector")).toBe(false);
    expect(porteeExigeFormation("public")).toBe(false);
  });

  it("fournit une recommandation et une étiquette pour chaque portée", () => {
    for (const p of PORTEES) {
      expect(recommandationPortee(p).length).toBeGreaterThan(10);
      const e = etiquettePortee(p);
      expect(e.libelle.length).toBeGreaterThan(0);
      expect(["neutre", "or", "succes", "alerte"]).toContain(e.ton);
    }
  });
});

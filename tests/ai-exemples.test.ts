import { describe, expect, it } from "vitest";
import {
  analyserModeExemples,
  choisirExemples,
  estCommercial,
  estimerJetons,
  EXEMPLES,
  formaterExemples,
  type ExempleReference,
} from "@/lib/ai/exemples/selection";
import { validerResultat } from "@/lib/ai/schema";
import { controlerPlan } from "@/lib/ai/controle-pedagogique";

/* ------------------------------------------------------------------
   Lot 25 – exemples de référence et sélection
   ------------------------------------------------------------------ */

const ex = (id: string, domaine: string, commercial: boolean, statut: ExempleReference["statut"] = "valide", taille = 400): ExempleReference => ({
  id,
  domaine,
  titre: id,
  source: "test",
  statut,
  confidentialite: "publiable",
  commercial,
  extrait: { texte: "x".repeat(taille) },
});

const JEU = [ex("management", "management", false), ex("restauration", "restauration", false), ex("vente", "vente", true)];

describe("exemples livrés", () => {
  it("portent domaine, source, statut et confidentialité, dans trois domaines différents", () => {
    expect(EXEMPLES).toHaveLength(3);
    expect(new Set(EXEMPLES.map((e) => e.domaine)).size).toBe(3);
    for (const e of EXEMPLES) {
      expect(e.source.length).toBeGreaterThan(20);
      expect(["valide", "a_valider_par_yakin"]).toContain(e.statut);
      expect(e.confidentialite).toBe("publiable");
    }
  });

  it("sont marqués « à valider par Yakin » tant qu'aucun module validé n'existe, donc inactifs par défaut", () => {
    expect(EXEMPLES.every((e) => e.statut === "a_valider_par_yakin")).toBe(true);
    expect(choisirExemples("santé")).toEqual([]);
    expect(choisirExemples("santé", 6000, { mode: "brouillons" }).length).toBeGreaterThan(0);
  });

  it("respectent eux-mêmes le schéma v2 et le contrôle pédagogique (sans erreur bloquante)", () => {
    for (const e of EXEMPLES) {
      const extrait = e.extrait as Record<string, unknown>;
      const a = validerResultat({ course: { title: e.titre }, ...extrait, warnings: [], validation_required: true });
      expect(a.ok, e.id).toBe(true);
      if (!a.ok) continue;
      const c = controlerPlan(a.resultat, { version: "v2", sujetCommercial: e.commercial });
      expect(c.erreurs, `${e.id} : ${c.erreurs.map((x) => x.message).join(" | ")}`).toEqual([]);
    }
  });
});

describe("estCommercial / analyserModeExemples / estimerJetons", () => {
  it("détecte un sujet commercial", () => {
    expect(estCommercial("vente en boutique")).toBe(true);
    expect(estCommercial("Relation client en agence bancaire")).toBe(true);
    expect(estCommercial("management d'équipe")).toBe(false);
    expect(estCommercial("")).toBe(false);
    expect(estCommercial(null)).toBe(false);
  });

  it("lit LLM_EXEMPLES", () => {
    expect(analyserModeExemples("")).toBe("on");
    expect(analyserModeExemples("off")).toBe("off");
    expect(analyserModeExemples("brouillons")).toBe("brouillons");
  });

  it("estime les jetons de façon prudente", () => {
    expect(estimerJetons("")).toBe(0);
    expect(estimerJetons("a".repeat(350))).toBe(100);
  });
});

describe("choisirExemples", () => {
  it("préfère un domaine différent du sujet", () => {
    const r = choisirExemples("management", 6000, { exemples: JEU, maximum: 1 });
    expect(r.map((e) => e.id)).toEqual(["restauration"]);
  });

  it("écarte les exemples commerciaux pour un sujet non commercial", () => {
    const r = choisirExemples("ressources humaines", 6000, { exemples: JEU, maximum: 3 });
    expect(r.map((e) => e.id)).toEqual(["management", "restauration"]);
  });

  it("pour un sujet commercial, garde les autres domaines en tête mais accepte l'exemple commercial", () => {
    expect(choisirExemples("vente additionnelle en boutique", 6000, { exemples: JEU, maximum: 2 }).map((e) => e.id)).toEqual([
      "management",
      "restauration",
    ]);
    expect(choisirExemples("vente additionnelle en boutique", 6000, { exemples: JEU, maximum: 3 }).map((e) => e.id)).toContain("vente");
  });

  it("respecte le budget de jetons", () => {
    const gros = [ex("a", "management", false, "valide", 10000), ex("b", "restauration", false, "valide", 500)];
    const r = choisirExemples("santé", 400, { exemples: gros });
    expect(r.map((e) => e.id)).toEqual(["b"]);
    expect(choisirExemples("santé", 0, { exemples: gros })).toEqual([]);
  });

  it("n'injecte rien en mode off, et n'injecte les brouillons qu'en mode brouillons", () => {
    const brouillons = [ex("x", "management", false, "a_valider_par_yakin")];
    expect(choisirExemples("santé", 6000, { exemples: brouillons })).toEqual([]);
    expect(choisirExemples("santé", 6000, { exemples: brouillons, mode: "brouillons" })).toHaveLength(1);
    expect(choisirExemples("santé", 6000, { exemples: JEU, mode: "off" })).toEqual([]);
  });

  it("ignore un exemple non publiable", () => {
    const confidentiel = { ...ex("c", "management", false), confidentialite: "confidentiel" as const };
    expect(choisirExemples("santé", 6000, { exemples: [confidentiel] })).toEqual([]);
  });
});

describe("formaterExemples", () => {
  it("numérote les exemples et montre le domaine, sans rien ajouter d'autre", () => {
    const t = formaterExemples(JEU.slice(0, 2));
    expect(t).toContain("### Exemple 1 — domaine : management");
    expect(t).toContain("### Exemple 2 — domaine : restauration");
    expect(formaterExemples([])).toBe("");
  });
});

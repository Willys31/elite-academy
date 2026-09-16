import { describe, expect, it } from "vitest";
import {
  fusionnerPreferences,
  lirePreferences,
  PREFERENCES_PAR_DEFAUT,
  validerPseudo,
} from "@/lib/profil/preferences";

describe("lirePreferences", () => {
  it("applique les défauts quand le JSON est vide ou invalide", () => {
    expect(lirePreferences({})).toEqual(PREFERENCES_PAR_DEFAUT);
    expect(lirePreferences(null)).toEqual(PREFERENCES_PAR_DEFAUT);
    expect(lirePreferences("texte")).toEqual(PREFERENCES_PAR_DEFAUT);
    expect(lirePreferences([1, 2])).toEqual(PREFERENCES_PAR_DEFAUT);
  });

  it("lit les valeurs présentes et ignore les types incorrects", () => {
    const p = lirePreferences({
      classement: { visible: false, pseudo: "  Awa K  " },
      entraide: { actif: "oui", depuis: "2026-09-01T00:00:00Z" },
    });
    expect(p.classement.visible).toBe(false);
    expect(p.classement.pseudo).toBe("Awa K");
    expect(p.entraide.actif).toBe(false); // "oui" n'est pas un booléen
    expect(p.entraide.depuis).toBe("2026-09-01T00:00:00Z");
  });

  it("rejette un pseudo trop court et coupe un pseudo trop long", () => {
    expect(lirePreferences({ classement: { pseudo: "A" } }).classement.pseudo).toBeNull();
    expect(
      lirePreferences({ classement: { pseudo: "x".repeat(50) } }).classement.pseudo
    ).toHaveLength(30);
  });
});

describe("fusionnerPreferences", () => {
  it("ne modifie que les clés fournies et conserve les clés étrangères", () => {
    const existant = { classement: { visible: false, pseudo: "Ko" }, theme: "sombre" };
    const resultat = fusionnerPreferences(existant, { entraide: { actif: true } });
    expect(resultat.theme).toBe("sombre");
    expect(resultat.classement).toEqual({ visible: false, pseudo: "Ko" });
    expect(resultat.entraide).toEqual({ actif: true, depuis: null });
  });

  it("part des défauts quand rien n'existe", () => {
    const resultat = fusionnerPreferences(undefined, { classement: { visible: false } });
    expect(resultat.classement).toEqual({ visible: false, pseudo: null });
    expect(resultat.entraide).toEqual(PREFERENCES_PAR_DEFAUT.entraide);
  });
});

describe("validerPseudo", () => {
  it("accepte vide (nom réel), normalise les espaces, borne la longueur", () => {
    expect(validerPseudo("   ")).toEqual({ ok: true, pseudo: null });
    expect(validerPseudo("  Awa   K ")).toEqual({ ok: true, pseudo: "Awa K" });
    expect(validerPseudo("A").ok).toBe(false);
    expect(validerPseudo("x".repeat(31)).ok).toBe(false);
    expect(validerPseudo("moi@exemple.com").ok).toBe(false);
  });
});

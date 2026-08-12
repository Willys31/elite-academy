import { describe, expect, it } from "vitest";
import {
  CERT_TYPE_LABELS,
  codeVerificationValide,
  genererCodeVerification,
  normaliserCodeVerification,
} from "@/lib/certificats/certificats";

describe("genererCodeVerification", () => {
  it("produit un code au format EA-XXXX-XXXX-XXXX", () => {
    const code = genererCodeVerification(() => 0.5);
    expect(code).toMatch(/^EA-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(codeVerificationValide(code)).toBe(true);
  });

  it("évite les caractères ambigus sur toute la plage aléatoire", () => {
    for (let i = 0; i < 100; i++) {
      const code = genererCodeVerification(() => i / 100);
      expect(code).not.toMatch(/[O0I1L]/);
      expect(codeVerificationValide(code)).toBe(true);
    }
  });

  it("reste valide même si la source retourne presque 1", () => {
    expect(codeVerificationValide(genererCodeVerification(() => 0.999999))).toBe(true);
  });
});

describe("normaliserCodeVerification / codeVerificationValide", () => {
  it("normalise espaces et minuscules", () => {
    expect(normaliserCodeVerification("  ea-abcd-efgh-jkmn ")).toBe(
      "EA-ABCD-EFGH-JKMN"
    );
  });

  it("valide les bons formats et rejette les mauvais", () => {
    expect(codeVerificationValide("EA-ABCD-EFGH-JKMN")).toBe(true);
    expect(codeVerificationValide("ea-abcd-efgh-jkmn")).toBe(true);
    expect(codeVerificationValide("EA-ABCD-EFGH")).toBe(false); // bloc manquant
    expect(codeVerificationValide("XX-ABCD-EFGH-JKMN")).toBe(false); // mauvais préfixe
    expect(codeVerificationValide("EA-AB0D-EFGH-JKMN")).toBe(false); // 0 ambigu
    expect(codeVerificationValide("")).toBe(false);
  });
});

describe("CERT_TYPE_LABELS", () => {
  it("couvre les quatre types du PRD", () => {
    expect(Object.keys(CERT_TYPE_LABELS).sort()).toEqual([
      "completion",
      "participation",
      "skill",
      "success",
    ]);
  });
});

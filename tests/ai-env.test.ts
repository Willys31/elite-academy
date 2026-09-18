import { describe, expect, it } from "vitest";
import { nettoyerValeurEnv } from "@/lib/ai/env";

describe("nettoyerValeurEnv", () => {
  it("laisse intacte une valeur propre", () => {
    expect(nettoyerValeurEnv("gemini")).toBe("gemini");
  });

  it("retire les guillemets saisis dans le tableau de bord d'un hébergeur", () => {
    expect(nettoyerValeurEnv('"gemini"')).toBe("gemini");
    expect(nettoyerValeurEnv("'gemini'")).toBe("gemini");
  });

  it("retire les espaces et retours à la ligne collés avec la clé", () => {
    expect(nettoyerValeurEnv("  cle-123\n")).toBe("cle-123");
    expect(nettoyerValeurEnv('" cle-123 "\r\n')).toBe("cle-123");
  });

  it("ne touche pas à un guillemet isolé ou dépareillé", () => {
    expect(nettoyerValeurEnv('"gemini')).toBe('"gemini');
    expect(nettoyerValeurEnv("\"gemini'")).toBe("\"gemini'");
    expect(nettoyerValeurEnv('"')).toBe('"');
  });

  it("renvoie une chaîne vide pour une variable absente ou vide", () => {
    expect(nettoyerValeurEnv(undefined)).toBe("");
    expect(nettoyerValeurEnv(null)).toBe("");
    expect(nettoyerValeurEnv("   ")).toBe("");
    expect(nettoyerValeurEnv('""')).toBe("");
  });
});

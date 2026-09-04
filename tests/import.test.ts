import { describe, expect, it } from "vitest";
import { decouperHtml, decouperTexte } from "@/lib/import/decoupage";

describe("decouperHtml (Word)", () => {
  it("découpe Titre 1 → modules et Titre 2 → leçons, avec le contenu", () => {
    const html = `
      <h1>Module A</h1>
      <h2>Leçon A1</h2><p>Contenu A1.</p><p>Suite A1.</p>
      <h2>Leçon A2</h2><p>Contenu A2.</p>
      <h1>Module B</h1>
      <h2>Leçon B1</h2><p>Contenu B1.</p>`;
    const r = decouperHtml(html);
    expect(r.modules).toHaveLength(2);
    expect(r.modules[0].title).toBe("Module A");
    expect(r.modules[0].lessons.map((l) => l.title)).toEqual(["Leçon A1", "Leçon A2"]);
    expect(r.modules[0].lessons[0].text).toContain("Contenu A1.");
    expect(r.modules[0].lessons[0].text).toContain("Suite A1.");
    expect(r.modules[1].lessons[0].text).toBe("Contenu B1.");
  });

  it("s'adapte quand le document commence aux Titres 2 (h2 → modules, h3 → leçons)", () => {
    const html = `<h2>Chapitre 1</h2><h3>Point 1</h3><p>Texte.</p>`;
    const r = decouperHtml(html);
    expect(r.modules[0].title).toBe("Chapitre 1");
    expect(r.modules[0].lessons[0].title).toBe("Point 1");
  });

  it("gère le contenu avant le premier titre (avant-propos) et les listes", () => {
    const html = `<p>Présentation générale.</p><h1>Module 1</h1><h2>Leçon 1</h2><li>Point de liste</li>`;
    const r = decouperHtml(html);
    expect(r.modules[0].title).toBe("Avant-propos");
    expect(r.modules[0].lessons[0].text).toContain("Présentation générale.");
    expect(r.modules[1].lessons[0].text).toContain("• Point de liste");
  });

  it("un seul niveau de titre : chaque titre devient module + leçon unique, avec avertissement", () => {
    const html = `<h1>Sujet 1</h1><p>Texte 1.</p><h1>Sujet 2</h1><p>Texte 2.</p>`;
    const r = decouperHtml(html);
    expect(r.modules).toHaveLength(2);
    expect(r.modules[0].lessons).toHaveLength(1);
    expect(r.warnings.some((w) => w.includes("seul niveau de titre"))).toBe(true);
  });

  it("sans aucun titre : une seule leçon et un avertissement honnête", () => {
    const r = decouperHtml("<p>Juste du texte.</p><p>Encore.</p>");
    expect(r.modules).toHaveLength(1);
    expect(r.modules[0].lessons[0].text).toContain("Juste du texte.");
    expect(r.warnings.some((w) => w.includes("aucun titre"))).toBe(true);
  });

  it("décode les entités HTML et ignore les balises internes", () => {
    const html = `<h1>Vente &amp; retail</h1><h2>Leçon</h2><p>Texte <strong>important</strong> &agrave; lire&nbsp;!</p>`;
    const r = decouperHtml(html);
    expect(r.modules[0].title).toBe("Vente & retail");
    expect(r.modules[0].lessons[0].text).toContain("Texte important");
  });

  it("document vide : structure minimale garantie", () => {
    const r = decouperHtml("");
    expect(r.modules).toHaveLength(1);
    expect(r.modules[0].lessons).toHaveLength(1);
  });
});

describe("decouperTexte (PDF)", () => {
  it("découpe par numérotation 1. / 1.1 et ajoute toujours l'avertissement PDF", () => {
    const texte = [
      "1. Introduction au management",
      "Le management consiste à…",
      "1.1 Définitions",
      "Quelques définitions utiles.",
      "1.2 Enjeux",
      "Les enjeux principaux.",
      "2. La délégation",
      "Déléguer, c'est…",
    ].join("\n");
    const r = decouperTexte(texte);
    expect(r.modules.map((m) => m.title)).toEqual([
      "1. Introduction au management",
      "2. La délégation",
    ]);
    expect(r.modules[0].lessons.map((l) => l.title)).toContain("1.1 Définitions");
    expect(r.warnings.some((w) => w.includes("PDF"))).toBe(true);
  });

  it("reconnaît les mots-clés Module/Chapitre et les lignes en majuscules", () => {
    const texte = [
      "CHAPITRE 1 LES BASES",
      "Contenu du chapitre.",
      "Module 2 : approfondissement",
      "Suite du contenu.",
    ].join("\n");
    const r = decouperTexte(texte);
    expect(r.modules).toHaveLength(2);
  });

  it("texte sans structure : une seule leçon + avertissements", () => {
    const r = decouperTexte("juste une longue phrase sans structure particulière.");
    expect(r.modules).toHaveLength(1);
    expect(r.warnings.length).toBeGreaterThanOrEqual(2);
  });

  it("texte vide (PDF scanné) : signalé clairement", () => {
    const r = decouperTexte("");
    expect(r.warnings.some((w) => w.includes("Aucun texte"))).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import {
  decouperHtml,
  decouperTexte,
  deduireIntervalle,
  libelleCourt,
  libelleIntervalle,
  retirerMarqueurs,
  texteAvecMarqueursPages,
  unionIntervalles,
} from "@/lib/import/decoupage";

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

describe("positions dans le document (lot 21)", () => {
  it("decouperTexte attribue à chaque leçon ses pages à partir des repères", () => {
    const texte = texteAvecMarqueursPages([
      { num: 1, text: "1. Introduction\nLe management consiste à…" },
      { num: 2, text: "1.1 Définitions\nQuelques définitions." },
      { num: 3, text: "Suite des définitions.\n1.2 Enjeux\nLes enjeux." },
      { num: 4, text: "2. La délégation\nDéléguer, c'est…" },
    ]);
    const r = decouperTexte(texte);
    const lecons = r.modules.flatMap((m) => m.lessons);
    expect(lecons.map((l) => l.title)).toEqual([
      "1. Introduction",
      "1.1 Définitions",
      "1.2 Enjeux",
      "2. La délégation",
    ]);
    expect(lecons[0].range).toEqual({ kind: "pages", from: 1, to: 1 });
    // Page frontière partagée : la leçon 1.1 finit page 3, 1.2 commence page 3.
    expect(lecons[1].range).toEqual({ kind: "pages", from: 2, to: 3 });
    expect(lecons[2].range).toEqual({ kind: "pages", from: 3, to: 3 });
    expect(lecons[3].range).toEqual({ kind: "pages", from: 4, to: 4 });
    // Les repères ne sont jamais du contenu.
    expect(lecons.every((l) => !l.text.includes("[[PAGE"))).toBe(true);
  });

  it("sans repère, aucune position n'est inventée", () => {
    const r = decouperTexte("1. Un\ntexte\n2. Deux\nautre");
    expect(r.modules.flatMap((m) => m.lessons).every((l) => l.range === undefined)).toBe(true);
  });

  it("un PDF sans structure garde l'intervalle complet", () => {
    const r = decouperTexte(texteAvecMarqueursPages([{ num: 1, text: "a" }, { num: 2, text: "b" }]));
    expect(r.modules[0].lessons[0].range).toEqual({ kind: "pages", from: 1, to: 2 });
  });

  it("deduireIntervalle retrouve les pages d'un texte par son début et sa fin", () => {
    const pages = [
      "Première page sans rapport avec le reste du document.",
      "La délégation consiste à confier une mission à un collaborateur en lui laissant une marge de manœuvre.",
      "Elle suppose de définir le résultat attendu, le délai et les moyens accordés.",
      "Dernière page : conclusion générale et remerciements.",
    ];
    const texte =
      "La délégation consiste à confier une mission à un collaborateur en lui laissant une marge de manœuvre. " +
      "Elle suppose de définir le résultat attendu, le délai et les moyens accordés.";
    expect(deduireIntervalle(texte, pages, "pages")).toEqual({ kind: "pages", from: 2, to: 3 });
    expect(
      deduireIntervalle("Texte absent du document, suffisamment long pour être cherché.", pages, "pages")
    ).toBeNull();
    expect(deduireIntervalle("court", pages, "pages")).toBeNull();
  });

  it("libellés et réunion d'intervalles", () => {
    expect(libelleIntervalle({ kind: "pages", from: 12, to: 18 })).toBe("Pages 12 à 18");
    expect(libelleIntervalle({ kind: "pages", from: 7, to: 7 })).toBe("Page 7");
    expect(libelleIntervalle({ kind: "slides", from: 20, to: 31 })).toBe("Diapositives 20 à 31");
    expect(libelleCourt({ kind: "pages", from: 12, to: 18 })).toBe("p. 12–18");
    expect(libelleCourt({ kind: "slides", from: 4, to: 4 })).toBe("diapo 4");
    expect(unionIntervalles({ kind: "pages", from: 1, to: 3 }, { kind: "pages", from: 4, to: 6 })).toEqual({
      kind: "pages",
      from: 1,
      to: 6,
    });
    expect(unionIntervalles({ kind: "pages", from: 1, to: 3 }, { kind: "pages", from: 3, to: 5 })).toEqual({
      kind: "pages",
      from: 1,
      to: 5,
    });
    expect(unionIntervalles({ kind: "pages", from: 1, to: 3 }, { kind: "pages", from: 5, to: 6 })).toBeNull();
    expect(unionIntervalles({ kind: "pages", from: 1, to: 3 }, { kind: "slides", from: 4, to: 6 })).toBeNull();
  });

  it("retirerMarqueurs nettoie un texte recopié par l'IA", () => {
    expect(retirerMarqueurs("[[PAGE 3]]\nTexte utile\n[[DIAPOSITIVE 4 : Titre]]\nSuite")).toBe(
      "Texte utile\n\nSuite"
    );
  });
});

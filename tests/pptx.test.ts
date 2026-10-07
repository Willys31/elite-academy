import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import {
  decouperDiapositives,
  diapositivesVersTexte,
  lirePresentation,
  resoudreCible,
} from "@/lib/import/pptx";
import { ouvrirDecoupeurPptx } from "@/lib/import/extraits";

/**
 * PowerPoint minimal construit en mémoire : trois diapositives dont
 * l'ORDRE (sldIdLst) ne suit pas le nom des fichiers, deux sections,
 * une disposition « en-tête de section », une page de notes et une
 * image utilisée par la seule troisième diapositive.
 */
const NS = `xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"`;
const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

function forme(type: string | null, paragraphes: string[]): string {
  const ph = type ? `<p:ph type="${type}"/>` : "";
  return `<p:sp><p:nvSpPr><p:cNvPr id="1" name="f"/><p:cNvSpPr/><p:nvPr>${ph}</p:nvPr></p:nvSpPr><p:txBody>${paragraphes
    .map((t) => `<a:p><a:r><a:t>${t}</a:t></a:r></a:p>`)
    .join("")}</p:txBody></p:sp>`;
}

function diapositive(contenu: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld ${NS}><p:cSld><p:spTree>${contenu}</p:spTree></p:cSld></p:sld>`;
}

function relations(liste: Array<[string, string, string]>): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${liste
    .map(([id, type, cible]) => `<Relationship Id="${id}" Type="${REL}/${type}" Target="${cible}"/>`)
    .join("")}</Relationships>`;
}

async function construirePptx(): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/><Override PartName="/ppt/slides/slide2.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/><Override PartName="/ppt/slides/slide3.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/><Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/><Override PartName="/ppt/slideLayouts/slideLayout2.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/><Override PartName="/ppt/notesSlides/notesSlide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`
  );
  zip.file("_rels/.rels", relations([["rId1", "officeDocument", "ppt/presentation.xml"], ["rId2", "extended-properties", "docProps/app.xml"]]));
  zip.file(
    "ppt/presentation.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:presentation ${NS} xmlns:p14="http://schemas.microsoft.com/office/powerpoint/2010/main"><p:sldIdLst><p:sldId id="256" r:id="rId2"/><p:sldId id="257" r:id="rId1"/><p:sldId id="258" r:id="rId3"/></p:sldIdLst><p:extLst><p:ext uri="{521415D9-36F7-43E2-AB2F-B90AF26B5E84}"><p14:sectionLst><p14:section name="Intro" id="{A}"><p14:sldIdLst><p14:sldId id="256"/></p14:sldIdLst></p14:section><p14:section name="Suite &amp; fin" id="{B}"><p14:sldIdLst><p14:sldId id="257"/><p14:sldId id="258"/></p14:sldIdLst></p14:section></p14:sectionLst></p:ext></p:extLst></p:presentation>`
  );
  zip.file(
    "ppt/_rels/presentation.xml.rels",
    relations([
      ["rId1", "slide", "slides/slide1.xml"],
      ["rId2", "slide", "slides/slide2.xml"],
      ["rId3", "slide", "slides/slide3.xml"],
    ])
  );
  // Diapositive n° 1 (fichier slide2) : en-tête de section, sans corps.
  zip.file("ppt/slides/slide2.xml", diapositive(forme("title", ["Partie A"])));
  zip.file("ppt/slides/_rels/slide2.xml.rels", relations([["rId1", "slideLayout", "../slideLayouts/slideLayout1.xml"]]));
  // Diapositive n° 2 (fichier slide1) : titre + corps + notes.
  zip.file(
    "ppt/slides/slide1.xml",
    diapositive(forme("title", ["Contenu"]) + forme("body", ["Point un", "Point &amp; deux"]) + forme("sldNum", ["2"]))
  );
  zip.file(
    "ppt/slides/_rels/slide1.xml.rels",
    relations([
      ["rId1", "slideLayout", "../slideLayouts/slideLayout2.xml"],
      ["rId2", "notesSlide", "../notesSlides/notesSlide1.xml"],
    ])
  );
  // Diapositive n° 3 (fichier slide3) : image.
  zip.file("ppt/slides/slide3.xml", diapositive(forme("title", ["Image"]) + forme(null, ["Voir figure"])));
  zip.file(
    "ppt/slides/_rels/slide3.xml.rels",
    relations([
      ["rId1", "slideLayout", "../slideLayouts/slideLayout2.xml"],
      ["rId2", "image", "../media/image1.png"],
    ])
  );
  zip.file("ppt/slideLayouts/slideLayout1.xml", `<p:sldLayout ${NS} type="secHead"><p:cSld><p:spTree/></p:cSld></p:sldLayout>`);
  zip.file("ppt/slideLayouts/slideLayout2.xml", `<p:sldLayout ${NS} type="obj"><p:cSld><p:spTree/></p:cSld></p:sldLayout>`);
  zip.file(
    "ppt/notesSlides/notesSlide1.xml",
    `<p:notes ${NS}><p:cSld><p:spTree>${forme("sldImg", [])}${forme("body", ["Note du présentateur"])}</p:spTree></p:cSld></p:notes>`
  );
  zip.file("ppt/media/image1.png", new Uint8Array([137, 80, 78, 71]));
  zip.file(
    "docProps/app.xml",
    `<Properties><Slides>3</Slides><Notes>1</Notes></Properties>`
  );
  return zip.generateAsync({ type: "uint8array" });
}

describe("lirePresentation", () => {
  it("suit l'ordre de sldIdLst, pas le nom des fichiers, et lit titres, corps, notes, dispositions", async () => {
    const p = await lirePresentation(await construirePptx());
    expect(p.total).toBe(3);
    expect(p.diapositives.map((d) => d.titre)).toEqual(["Partie A", "Contenu", "Image"]);
    expect(p.diapositives.map((d) => d.chemin)).toEqual([
      "ppt/slides/slide2.xml",
      "ppt/slides/slide1.xml",
      "ppt/slides/slide3.xml",
    ]);
    expect(p.diapositives[1].texte).toBe("Point un\nPoint & deux");
    expect(p.diapositives[1].notes).toBe("Note du présentateur");
    expect(p.diapositives[0].disposition).toBe("secHead");
    expect(p.diapositives[2].texte).toBe("Voir figure");
  });

  it("lit les sections avec leurs bornes", async () => {
    const p = await lirePresentation(await construirePptx());
    expect(p.sections).toEqual([
      { titre: "Intro", de: 1, a: 1 },
      { titre: "Suite & fin", de: 2, a: 3 },
    ]);
  });

  it("résout les cibles relatives et absolues des relations", () => {
    expect(resoudreCible("ppt/slides/slide1.xml", "../media/image1.png")).toBe("ppt/media/image1.png");
    expect(resoudreCible("ppt/presentation.xml", "slides/slide1.xml")).toBe("ppt/slides/slide1.xml");
    expect(resoudreCible("ppt/presentation.xml", "/ppt/slides/slide1.xml")).toBe("ppt/slides/slide1.xml");
  });
});

describe("découpage et texte pour l'IA", () => {
  it("sections → modules ; diapositives regroupées en leçons avec leurs intervalles", async () => {
    const p = await lirePresentation(await construirePptx());
    const d = decouperDiapositives(p, "cours.pptx");
    expect(d.modules.map((m) => m.title)).toEqual(["Intro", "Suite & fin"]);
    expect(d.modules[0].lessons[0]).toMatchObject({ title: "Partie A", range: { kind: "slides", from: 1, to: 1 } });
    // Section sans diapositive séparatrice : une leçon par diapositive,
    // à fusionner au besoin dans l'éditeur.
    expect(d.modules[1].lessons).toHaveLength(2);
    expect(d.modules[1].lessons[0].range).toEqual({ kind: "slides", from: 2, to: 2 });
    expect(d.modules[1].lessons[1].range).toEqual({ kind: "slides", from: 3, to: 3 });
    expect(d.modules[1].lessons[0].text).toContain("Point un");
    expect(d.modules[1].lessons[0].text).toContain("Notes : Note du présentateur");
    expect(d.modules[1].lessons[1].text).toContain("Voir figure");
    expect(d.warnings.some((w) => w.includes("PowerPoint"))).toBe(true);
  });

  it("insère un repère par diapositive", async () => {
    const texte = diapositivesVersTexte(await lirePresentation(await construirePptx()));
    expect(texte).toContain("[[DIAPOSITIVE 1 : Partie A]]");
    expect(texte).toContain("[[DIAPOSITIVE 2 : Contenu]]");
    expect(texte).toContain("Notes : Note du présentateur");
  });
});

describe("ouvrirDecoupeurPptx", () => {
  it("ne garde que les diapositives de l'intervalle et les parties qu'elles atteignent", async () => {
    const decoupeur = await ouvrirDecoupeurPptx(await construirePptx());
    expect(decoupeur.total).toBe(3);
    const extrait = await decoupeur.extraire(1, 2);
    const zip = await JSZip.loadAsync(extrait);
    const noms = Object.keys(zip.files);

    expect(noms).toContain("ppt/slides/slide2.xml");
    expect(noms).toContain("ppt/slides/slide1.xml");
    expect(noms).toContain("ppt/notesSlides/notesSlide1.xml");
    expect(noms).not.toContain("ppt/slides/slide3.xml");
    expect(noms).not.toContain("ppt/slides/_rels/slide3.xml.rels");
    expect(noms).not.toContain("ppt/media/image1.png");
    expect(noms[0]).toBe("[Content_Types].xml");

    const presentation = await zip.file("ppt/presentation.xml")!.async("string");
    expect(presentation.match(/<p:sldId\b/g)).toHaveLength(2);
    expect(presentation).not.toContain("sectionLst");
    expect(presentation).not.toContain("<p:extLst>");

    const types = await zip.file("[Content_Types].xml")!.async("string");
    expect(types).not.toContain("slide3.xml");
    expect(types).toContain("slide1.xml");

    const app = await zip.file("docProps/app.xml")!.async("string");
    expect(app).toContain("<Slides>2</Slides>");

    const relu = await lirePresentation(extrait);
    expect(relu.diapositives.map((d) => d.titre)).toEqual(["Partie A", "Contenu"]);
  });

  it("conserve l'image quand la diapositive qui l'utilise est gardée", async () => {
    const decoupeur = await ouvrirDecoupeurPptx(await construirePptx());
    const zip = await JSZip.loadAsync(await decoupeur.extraire(3, 3));
    const noms = Object.keys(zip.files);
    expect(noms).toContain("ppt/media/image1.png");
    expect(noms).not.toContain("ppt/notesSlides/notesSlide1.xml");
    const relu = await lirePresentation(await decoupeur.extraire(3, 3));
    expect(relu.diapositives.map((d) => d.titre)).toEqual(["Image"]);
  });

  it("refuse un intervalle hors du document", async () => {
    const decoupeur = await ouvrirDecoupeurPptx(await construirePptx());
    await expect(decoupeur.extraire(2, 5)).rejects.toThrow(/Intervalle invalide/);
  });
});

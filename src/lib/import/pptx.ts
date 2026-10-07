/**
 * Lecture d'un PowerPoint (.pptx) et découpage en modules / leçons –
 * logique pure, sans service externe.
 *
 * Un .pptx est une archive ZIP de fichiers XML (Office Open XML). On y
 * lit l'ordre des diapositives, leur titre, leur corps, leurs notes,
 * leur disposition et les sections de la présentation. La lecture se
 * fait par expressions régulières sur le XML : le vocabulaire
 * DrawingML concerné est stable et borné, et cela évite d'embarquer un
 * analyseur XML complet.
 *
 * Point essentiel : la NUMÉROTATION des diapositives vient de la liste
 * `p:sldIdLst` de `ppt/presentation.xml`, jamais du nom des fichiers
 * (`slide7.xml` peut être la troisième diapositive après des
 * déplacements dans PowerPoint).
 */

import JSZip from "jszip";
import {
  MAX_LECONS_PAR_MODULE,
  normaliser,
  structureMinimale,
  type Decoupage,
  type LeconImportee,
  type ModuleImporte,
} from "@/lib/import/decoupage";

export interface Diapositive {
  /** Numéro dans l'ordre de la présentation, à partir de 1. */
  num: number;
  titre: string;
  /** Corps de la diapositive (hors titre, numéro, date, pied de page). */
  texte: string;
  /** Notes du présentateur. */
  notes: string;
  /** Attribut `type` de la disposition : title, secHead, obj, titleOnly… */
  disposition: string | null;
  /** Chemin de la partie dans l'archive, ex. `ppt/slides/slide3.xml`. */
  chemin: string;
}

export interface SectionPresentation {
  titre: string;
  /** Première et dernière diapositive de la section (inclusives, 1-based). */
  de: number;
  a: number;
}

export interface Presentation {
  diapositives: Diapositive[];
  sections: SectionPresentation[];
  total: number;
}

export interface Relation {
  id: string;
  type: string;
  /** Chemin résolu dans l'archive (sans « / » initial). */
  cible: string;
  externe: boolean;
}

/** Suffixes des types de relations OOXML utilisés ici. */
const TYPE_SLIDE = "/relationships/slide";
const TYPE_LAYOUT = "/relationships/slideLayout";
const TYPE_NOTES = "/relationships/notesSlide";

/** URI de l'extension « sections » de PowerPoint 2010. */
export const URI_SECTIONS = "{521415D9-36F7-43E2-AB2F-B90AF26B5E84}";

// ------------------------------------------------------------
// Utilitaires d'archive
// ------------------------------------------------------------

export function decoderEntites(t: string): string {
  return t
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, "&");
}

/** Chemin du fichier de relations d'une partie : `ppt/slides/_rels/slide1.xml.rels`. */
export function cheminRels(partie: string): string {
  const i = partie.lastIndexOf("/");
  const dossier = i === -1 ? "" : partie.slice(0, i + 1);
  const nom = i === -1 ? partie : partie.slice(i + 1);
  return `${dossier}_rels/${nom}.rels`;
}

/** Résout une cible de relation (relative à la partie, ou absolue « /ppt/… »). */
export function resoudreCible(partie: string, cible: string): string {
  if (cible.startsWith("/")) return cible.slice(1);
  const base = partie.includes("/") ? partie.slice(0, partie.lastIndexOf("/")).split("/") : [];
  for (const segment of cible.split("/")) {
    if (segment === "..") base.pop();
    else if (segment !== "." && segment !== "") base.push(segment);
  }
  return base.join("/");
}

/** Relations d'une partie, lues dans son fichier `.rels` (vide si absent). */
export async function lireRelations(zip: JSZip, partie: string): Promise<Relation[]> {
  const fichier = zip.file(cheminRels(partie));
  if (!fichier) return [];
  return analyserRelations(await fichier.async("string"), partie);
}

export function analyserRelations(xml: string, partie: string): Relation[] {
  const relations: Relation[] = [];
  const motif = /<Relationship\b([^>]*)\/?>/g;
  let m: RegExpExecArray | null;
  while ((m = motif.exec(xml)) !== null) {
    const attrs = m[1];
    const id = /\bId="([^"]*)"/.exec(attrs)?.[1];
    const type = /\bType="([^"]*)"/.exec(attrs)?.[1];
    const target = /\bTarget="([^"]*)"/.exec(attrs)?.[1];
    if (!id || !type || target === undefined) continue;
    const externe = /\bTargetMode="External"/.test(attrs);
    relations.push({
      id,
      type,
      cible: externe ? target : resoudreCible(partie, decoderEntites(target)),
      externe,
    });
  }
  return relations;
}

/** Diapositives dans l'ordre de `p:sldIdLst`, avec leur identifiant et leur chemin. */
export async function ordreDiapositives(
  zip: JSZip
): Promise<Array<{ id: string; rId: string; chemin: string }>> {
  const presentation = await zip.file("ppt/presentation.xml")?.async("string");
  if (!presentation) throw new Error("Archive PowerPoint invalide : ppt/presentation.xml absent.");
  const relations = await lireRelations(zip, "ppt/presentation.xml");
  const parId = new Map(relations.map((r) => [r.id, r]));

  const liste = /<p:sldIdLst>([\s\S]*?)<\/p:sldIdLst>/.exec(presentation)?.[1] ?? "";
  const resultat: Array<{ id: string; rId: string; chemin: string }> = [];
  const motif = /<p:sldId\b([^>]*)\/?>/g;
  let m: RegExpExecArray | null;
  while ((m = motif.exec(liste)) !== null) {
    const id = /\bid="(\d+)"/.exec(m[1])?.[1];
    const rId = /\br:id="([^"]*)"/.exec(m[1])?.[1];
    const relation = rId ? parId.get(rId) : undefined;
    if (!id || !rId || !relation || !relation.type.endsWith(TYPE_SLIDE)) continue;
    resultat.push({ id, rId, chemin: relation.cible });
  }
  return resultat;
}

// ------------------------------------------------------------
// Texte des diapositives
// ------------------------------------------------------------

interface Forme {
  /** Type de l'espace réservé (`title`, `body`, `sldNum`…) ou null. */
  type: string | null;
  paragraphes: string[];
}

/** Paragraphes (`a:p`) d'un fragment XML, chacun étant la concaténation de ses `a:t`. */
function paragraphesDe(xml: string): string[] {
  const paragraphes: string[] = [];
  const motifP = /<a:p\b[^>]*>([\s\S]*?)<\/a:p>/g;
  let p: RegExpExecArray | null;
  while ((p = motifP.exec(xml)) !== null) {
    const morceaux: string[] = [];
    const motifT = /<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>|<a:br\s*\/>/g;
    let t: RegExpExecArray | null;
    while ((t = motifT.exec(p[1])) !== null) {
      morceaux.push(t[1] === undefined ? "\n" : decoderEntites(t[1]));
    }
    const texte = morceaux.join("").replace(/[ \t]+/g, " ").trim();
    if (texte) paragraphes.push(texte);
  }
  return paragraphes;
}

/** Formes (`p:sp`, tableaux `p:graphicFrame`) d'une diapositive ou d'une page de notes. */
function formesDe(xml: string): Forme[] {
  const formes: Forme[] = [];
  const motif = /<p:(sp|graphicFrame)\b[^>]*>([\s\S]*?)<\/p:\1>/g;
  let m: RegExpExecArray | null;
  while ((m = motif.exec(xml)) !== null) {
    const nvPr = /<p:nvPr\b[^>]*>([\s\S]*?)<\/p:nvPr>|<p:nvPr\s*\/>/.exec(m[2])?.[1] ?? "";
    const ph = /<p:ph\b([^>]*)\/?>/.exec(nvPr)?.[1];
    const type = ph === undefined ? null : (/\btype="([^"]*)"/.exec(ph)?.[1] ?? "body");
    formes.push({ type, paragraphes: paragraphesDe(m[2]) });
  }
  return formes;
}

const TYPES_TITRE = new Set(["title", "ctrTitle"]);
const TYPES_IGNORES = new Set(["sldNum", "dt", "ftr", "sldImg", "hdr"]);

function texteDiapositive(xml: string): { titre: string; texte: string } {
  const formes = formesDe(xml);
  const titre = formes
    .filter((f) => f.type !== null && TYPES_TITRE.has(f.type))
    .flatMap((f) => f.paragraphes)
    .join(" ")
    .trim();
  const corps = formes
    .filter((f) => !(f.type !== null && (TYPES_TITRE.has(f.type) || TYPES_IGNORES.has(f.type))))
    .flatMap((f) => f.paragraphes);
  if (titre) return { titre, texte: corps.join("\n") };
  // Sans espace réservé de titre : la première ligne fait office de titre.
  const [premiere, ...reste] = corps;
  return { titre: premiere ?? "", texte: reste.join("\n") };
}

function texteNotes(xml: string): string {
  return formesDe(xml)
    .filter((f) => f.type === "body" || f.type === null)
    .flatMap((f) => f.paragraphes)
    .join("\n")
    .trim();
}

async function dispositionDe(zip: JSZip, relations: Relation[]): Promise<string | null> {
  const relation = relations.find((r) => r.type.endsWith(TYPE_LAYOUT) && !r.externe);
  if (!relation) return null;
  const xml = await zip.file(relation.cible)?.async("string");
  if (!xml) return null;
  return /<p:sldLayout\b[^>]*\btype="([^"]*)"/.exec(xml)?.[1] ?? null;
}

function sectionsDe(presentation: string, idsOrdonnes: string[]): SectionPresentation[] {
  const bloc = new RegExp(
    `<p:ext\\b[^>]*uri="${URI_SECTIONS.replace(/[{}]/g, "\\$&")}"[^>]*>([\\s\\S]*?)<\\/p:ext>`
  ).exec(presentation)?.[1];
  if (!bloc) return [];
  const index = new Map(idsOrdonnes.map((id, i) => [id, i + 1]));
  const sections: SectionPresentation[] = [];
  const motif = /<p14:section\b([^>]*)>([\s\S]*?)<\/p14:section>/g;
  let m: RegExpExecArray | null;
  while ((m = motif.exec(presentation)) !== null) {
    const titre = decoderEntites(/\bname="([^"]*)"/.exec(m[1])?.[1] ?? "").trim();
    const numeros: number[] = [];
    const motifId = /<p14:sldId\b[^>]*\bid="(\d+)"/g;
    let s: RegExpExecArray | null;
    while ((s = motifId.exec(m[2])) !== null) {
      const n = index.get(s[1]);
      if (n) numeros.push(n);
    }
    if (numeros.length === 0) continue;
    sections.push({ titre, de: Math.min(...numeros), a: Math.max(...numeros) });
  }
  return sections.sort((a, b) => a.de - b.de);
}

/** Lit une présentation : diapositives dans l'ordre, notes, dispositions, sections. */
export async function lirePresentation(contenu: Uint8Array): Promise<Presentation> {
  const zip = await JSZip.loadAsync(contenu);
  const presentation = (await zip.file("ppt/presentation.xml")?.async("string")) ?? "";
  const ordre = await ordreDiapositives(zip);

  const diapositives: Diapositive[] = [];
  for (const [i, entree] of ordre.entries()) {
    const xml = (await zip.file(entree.chemin)?.async("string")) ?? "";
    const relations = await lireRelations(zip, entree.chemin);
    const { titre, texte } = texteDiapositive(xml);
    const relationNotes = relations.find((r) => r.type.endsWith(TYPE_NOTES) && !r.externe);
    const notes = relationNotes
      ? texteNotes((await zip.file(relationNotes.cible)?.async("string")) ?? "")
      : "";
    diapositives.push({
      num: i + 1,
      titre,
      texte,
      notes,
      disposition: await dispositionDe(zip, relations),
      chemin: entree.chemin,
    });
  }

  return {
    diapositives,
    sections: sectionsDe(presentation, ordre.map((o) => o.id)),
    total: diapositives.length,
  };
}

// ------------------------------------------------------------
// Texte pour l'IA et découpage heuristique
// ------------------------------------------------------------

/**
 * Texte balisé pour le LLM : un repère par diapositive, le corps,
 * puis les notes du présentateur (qui portent souvent la vraie
 * matière pédagogique).
 */
export function diapositivesVersTexte(p: Presentation): string {
  return p.diapositives
    .map((d) => {
      const lignes = [`[[DIAPOSITIVE ${d.num}${d.titre ? ` : ${d.titre.replace(/[\[\]]/g, "")}` : ""}]]`];
      if (d.titre) lignes.push(`# ${d.titre}`);
      if (d.texte) lignes.push(d.texte);
      if (d.notes) lignes.push(`Notes : ${d.notes}`);
      return lignes.join("\n");
    })
    .join("\n\n");
}

const DISPOSITIONS_SEPARATRICES = new Set(["secHead", "title"]);

/**
 * Découpage sans IA : les sections de la présentation deviennent des
 * modules ; dans chaque module, une diapositive d'en-tête de section,
 * de titre ou sans corps ouvre une leçon, les suivantes s'y
 * accumulent. Sans séparateur détectable : une leçon par diapositive.
 */
export function decouperDiapositives(p: Presentation, nomFichier: string): Decoupage {
  const warnings = [
    "Import depuis un PowerPoint : la structure a été devinée à partir des sections et des diapositives de titre. Vérifiez le découpage dans l'éditeur — les diapositives correspondantes sont jointes à chaque leçon.",
  ];
  const total = p.total;
  if (total === 0 || p.diapositives.every((d) => !d.titre && !d.texte && !d.notes)) {
    return structureMinimale(
      "",
      [...warnings, "Aucun texte n'a pu être extrait de cette présentation (images seules ?)."],
      total > 0 ? { kind: "slides", from: 1, to: total } : undefined
    );
  }

  const couverture = p.diapositives[0]?.disposition === "title" ? p.diapositives[0] : null;
  const titreParDefaut =
    couverture?.titre || nomFichier.replace(/\.pptx$/i, "").replace(/[-_]+/g, " ").trim();

  const plages: Array<{ titre: string; de: number; a: number }> =
    p.sections.length > 0
      ? p.sections.map((s) => ({ titre: s.titre || "Section", de: s.de, a: s.a }))
      : [{ titre: titreParDefaut, de: 1, a: total }];

  const texteDe = (d: Diapositive) =>
    [d.titre, d.texte, d.notes ? `Notes : ${d.notes}` : ""].filter(Boolean).join("\n");

  const modules: ModuleImporte[] = [];
  for (const plage of plages) {
    const diapos = p.diapositives.filter(
      (d) => d.num >= plage.de && d.num <= plage.a && d !== couverture
    );
    if (diapos.length === 0) continue;

    const lecons: LeconImportee[] = [];
    let courante: LeconImportee | null = null;
    let separateurs = 0;
    for (const d of diapos) {
      const separatrice =
        (d.disposition !== null && DISPOSITIONS_SEPARATRICES.has(d.disposition)) || !d.texte;
      if (separatrice || !courante) {
        if (separatrice && courante) separateurs++;
        courante = {
          title: d.titre || `Diapositive ${d.num}`,
          text: separatrice ? (d.notes ? `Notes : ${d.notes}` : "") : texteDe(d),
          range: { kind: "slides", from: d.num, to: d.num },
        };
        lecons.push(courante);
        continue;
      }
      courante.text += (courante.text ? "\n\n" : "") + texteDe(d);
      courante.range!.to = d.num;
    }

    // Aucun séparateur dans la section : une leçon par diapositive,
    // regroupées par tranches si la section est très longue.
    if (separateurs === 0 && lecons.length === 1 && diapos.length > 1) {
      const taille = Math.ceil(diapos.length / MAX_LECONS_PAR_MODULE);
      const regroupees: LeconImportee[] = [];
      for (let i = 0; i < diapos.length; i += taille) {
        const tranche = diapos.slice(i, i + taille);
        regroupees.push({
          title: tranche[0].titre || `Diapositive ${tranche[0].num}`,
          text: tranche.map(texteDe).join("\n\n"),
          range: { kind: "slides", from: tranche[0].num, to: tranche[tranche.length - 1].num },
        });
      }
      modules.push({ title: plage.titre, lessons: regroupees });
      continue;
    }
    modules.push({ title: plage.titre, lessons: lecons });
  }

  if (modules.length === 0) {
    return structureMinimale(p.diapositives.map(texteDe).join("\n\n"), warnings, {
      kind: "slides",
      from: 1,
      to: total,
    });
  }
  return normaliser(modules, warnings);
}

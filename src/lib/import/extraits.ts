/**
 * Génération des extraits d'un document source par intervalle de
 * pages (PDF) ou de diapositives (PowerPoint) – logique pure.
 *
 * Un « découpeur » est ouvert UNE fois par document (chargement
 * coûteux), puis produit autant d'extraits que de leçons.
 *
 * Pour le PowerPoint, l'archive n'est jamais re-sérialisée depuis un
 * arbre XML : on retire des éléments précis du texte XML d'origine et
 * on recopie tout le reste octet pour octet. C'est ce qui évite le
 * dialogue « PowerPoint a trouvé un problème… réparer ».
 */

import JSZip from "jszip";
import { PDFDocument } from "pdf-lib";
import type { Intervalle } from "@/lib/import/decoupage";
import {
  analyserRelations,
  cheminRels,
  ordreDiapositives,
  URI_SECTIONS,
} from "@/lib/import/pptx";
import { nomSur } from "@/lib/stockage/limites";

export interface DecoupeurExtraits {
  total: number;
  /** Extrait des unités `from` à `to` inclusives (1-based). */
  extraire(from: number, to: number): Promise<Uint8Array>;
}

function verifierBornes(from: number, to: number, total: number) {
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to < from || to > total) {
    throw new Error(`Intervalle invalide : ${from}–${to} sur ${total}.`);
  }
}

/** « Cours-p12-18.pdf », « Cours-d20-31.pptx », « Cours-p7.pdf ». */
export function nomExtrait(nomOriginal: string, i: Intervalle): string {
  const point = nomOriginal.lastIndexOf(".");
  const base = point === -1 ? nomOriginal : nomOriginal.slice(0, point);
  const ext = point === -1 ? "" : nomOriginal.slice(point).toLowerCase();
  const prefixe = i.kind === "pages" ? "p" : "d";
  const plage = i.from === i.to ? `${i.from}` : `${i.from}-${i.to}`;
  return `${nomSur(base).slice(0, 80)}-${prefixe}${plage}${ext}`;
}

// ------------------------------------------------------------
// PDF
// ------------------------------------------------------------

export async function ouvrirDecoupeurPdf(contenu: Uint8Array): Promise<DecoupeurExtraits> {
  const source = await PDFDocument.load(contenu, {
    ignoreEncryption: true,
    updateMetadata: false,
  });
  const total = source.getPageCount();
  return {
    total,
    async extraire(from, to) {
      verifierBornes(from, to, total);
      const cible = await PDFDocument.create();
      const indices = Array.from({ length: to - from + 1 }, (_, k) => from - 1 + k);
      const pages = await cible.copyPages(source, indices);
      for (const page of pages) cible.addPage(page);
      return cible.save({ useObjectStreams: true });
    },
  };
}

// ------------------------------------------------------------
// PowerPoint
// ------------------------------------------------------------

function echapperRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Retire un élément vide ou non d'une liste XML, par son attribut `r:id`. */
function retirerSldId(xml: string, rId: string): string {
  const id = echapperRegex(rId);
  return xml
    .replace(new RegExp(`<p:sldId\\b[^>]*\\br:id="${id}"[^>]*/>\\s*`, "g"), "")
    .replace(new RegExp(`<p:sldId\\b[^>]*\\br:id="${id}"[^>]*>[\\s\\S]*?</p:sldId>\\s*`, "g"), "");
}

function retirerRelation(xml: string, rId: string): string {
  const id = echapperRegex(rId);
  return xml
    .replace(new RegExp(`<Relationship\\b[^>]*\\bId="${id}"[^>]*/>\\s*`, "g"), "")
    .replace(new RegExp(`<Relationship\\b[^>]*\\bId="${id}"[^>]*>[\\s\\S]*?</Relationship>\\s*`, "g"), "");
}

/** Retire les sections (elles pointeraient vers des diapositives absentes) et les diaporamas personnalisés. */
function retirerSectionsEtDiaporamas(xml: string): string {
  const uri = echapperRegex(URI_SECTIONS);
  let resultat = xml.replace(new RegExp(`<p:ext\\b[^>]*uri="${uri}"[^>]*>[\\s\\S]*?</p:ext>\\s*`, "g"), "");
  resultat = resultat.replace(/<p:extLst>\s*<\/p:extLst>\s*/g, "");
  resultat = resultat.replace(/<p:custShowLst>[\s\S]*?<\/p:custShowLst>\s*/g, "");
  return resultat;
}

/**
 * Parties atteignables depuis `ppt/presentation.xml` en suivant les
 * fichiers de relations. `relsRacine` est le contenu DÉJÀ filtré des
 * relations de la présentation.
 */
async function partiesAtteignables(zip: JSZip, relsRacine: string): Promise<Set<string>> {
  const atteintes = new Set<string>(["ppt/presentation.xml", cheminRels("ppt/presentation.xml")]);
  const file = ["ppt/presentation.xml"];
  const relationsDe = async (partie: string): Promise<string[]> => {
    const xml =
      partie === "ppt/presentation.xml"
        ? relsRacine
        : await zip.file(cheminRels(partie))?.async("string");
    if (!xml) return [];
    return analyserRelations(xml, partie)
      .filter((r) => !r.externe)
      .map((r) => r.cible);
  };
  while (file.length > 0) {
    const partie = file.pop()!;
    for (const cible of await relationsDe(partie)) {
      if (atteintes.has(cible)) continue;
      if (!zip.file(cible)) continue;
      atteintes.add(cible);
      atteintes.add(cheminRels(cible));
      file.push(cible);
    }
  }
  return atteintes;
}

export async function ouvrirDecoupeurPptx(contenu: Uint8Array): Promise<DecoupeurExtraits> {
  const zip = await JSZip.loadAsync(contenu);
  const ordre = await ordreDiapositives(zip);
  const total = ordre.length;
  const presentationXml = (await zip.file("ppt/presentation.xml")?.async("string")) ?? "";
  const relsXml = (await zip.file(cheminRels("ppt/presentation.xml"))?.async("string")) ?? "";

  return {
    total,
    async extraire(from, to) {
      verifierBornes(from, to, total);
      const retirees = ordre.filter((_, i) => i + 1 < from || i + 1 > to);

      let presentation = retirerSectionsEtDiaporamas(presentationXml);
      let rels = relsXml;
      for (const d of retirees) {
        presentation = retirerSldId(presentation, d.rId);
        rels = retirerRelation(rels, d.rId);
      }

      const atteintes = await partiesAtteignables(zip, rels);
      const conserver = (chemin: string) =>
        !chemin.startsWith("ppt/") ||
        atteintes.has(chemin) ||
        chemin === "ppt/presentation.xml";

      const sortie = new JSZip();
      const chemins = Object.keys(zip.files).filter((c) => !zip.files[c].dir);
      // [Content_Types].xml doit rester la première entrée de l'archive.
      chemins.sort((a, b) =>
        a === "[Content_Types].xml" ? -1 : b === "[Content_Types].xml" ? 1 : 0
      );
      const presentes = new Set(chemins.filter(conserver));

      for (const chemin of chemins) {
        if (!presentes.has(chemin)) continue;
        if (chemin === "ppt/presentation.xml") {
          sortie.file(chemin, presentation);
        } else if (chemin === cheminRels("ppt/presentation.xml")) {
          sortie.file(chemin, rels);
        } else if (chemin === "[Content_Types].xml") {
          const types = (await zip.file(chemin)!.async("string")).replace(
            /<Override\b[^>]*\bPartName="\/([^"]*)"[^>]*\/>\s*/g,
            (bloc, partie: string) => (presentes.has(partie) ? bloc : "")
          );
          sortie.file(chemin, types);
        } else if (chemin === "docProps/app.xml") {
          const notes = [...presentes].filter((c) => /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(c)).length;
          const app = (await zip.file(chemin)!.async("string"))
            .replace(/<Slides>\d+<\/Slides>/, `<Slides>${to - from + 1}</Slides>`)
            .replace(/<Notes>\d+<\/Notes>/, `<Notes>${notes}</Notes>`);
          sortie.file(chemin, app);
        } else {
          sortie.file(chemin, await zip.file(chemin)!.async("uint8array"));
        }
      }

      return sortie.generateAsync({ type: "uint8array", compression: "DEFLATE" });
    },
  };
}

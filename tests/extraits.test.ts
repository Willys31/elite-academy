import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { nomExtrait, ouvrirDecoupeurPdf } from "@/lib/import/extraits";

async function pdfDeCinqPages(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 1; i <= 5; i++) {
    const page = doc.addPage([200, 200]);
    page.drawText(`Page ${i}`, { x: 20, y: 100 });
  }
  return doc.save();
}

describe("ouvrirDecoupeurPdf", () => {
  it("compte les pages et extrait un intervalle", async () => {
    const decoupeur = await ouvrirDecoupeurPdf(await pdfDeCinqPages());
    expect(decoupeur.total).toBe(5);
    const extrait = await PDFDocument.load(await decoupeur.extraire(2, 3));
    expect(extrait.getPageCount()).toBe(2);
    const unePage = await PDFDocument.load(await decoupeur.extraire(5, 5));
    expect(unePage.getPageCount()).toBe(1);
  });

  it("refuse un intervalle hors du document", async () => {
    const decoupeur = await ouvrirDecoupeurPdf(await pdfDeCinqPages());
    await expect(decoupeur.extraire(4, 6)).rejects.toThrow(/Intervalle invalide/);
    await expect(decoupeur.extraire(0, 1)).rejects.toThrow(/Intervalle invalide/);
  });
});

describe("nomExtrait", () => {
  it("nomme l'extrait d'après l'original et l'intervalle", () => {
    expect(nomExtrait("Cours été.pdf", { kind: "pages", from: 12, to: 18 })).toBe("Cours-ete-p12-18.pdf");
    expect(nomExtrait("Deck.PPTX", { kind: "slides", from: 20, to: 31 })).toBe("Deck-d20-31.pptx");
    expect(nomExtrait("Cours.pdf", { kind: "pages", from: 7, to: 7 })).toBe("Cours-p7.pdf");
  });
});

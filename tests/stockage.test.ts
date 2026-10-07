import { describe, expect, it } from "vitest";
import {
  cheminPour,
  estVideo,
  extensionDe,
  formaterTaille,
  mimePourNom,
  nomSur,
  TAILLE_MAX_FICHIER,
  TAILLE_MORCEAU_TUS,
  validerDemande,
} from "@/lib/stockage/limites";

const Go = 1000 ** 3;

describe("formaterTaille", () => {
  it("affiche les tailles en unités décimales françaises", () => {
    expect(formaterTaille(0)).toBe("0 o");
    expect(formaterTaille(512)).toBe("512 o");
    expect(formaterTaille(1500)).toBe("1,5 ko");
    expect(formaterTaille(650 * 1000 ** 2)).toBe("650 Mo");
    expect(formaterTaille(1.2 * Go)).toBe("1,2 Go");
  });

  it("reste lisible sur une valeur invalide", () => {
    expect(formaterTaille(-1)).toBe("—");
    expect(formaterTaille(Number.NaN)).toBe("—");
  });
});

describe("formats", () => {
  it("reconnaît l'extension quelle que soit la casse", () => {
    expect(extensionDe("Cours.MOV")).toBe(".mov");
    expect(mimePourNom("Cours.MOV")).toBe("video/quicktime");
    expect(mimePourNom("video.webm")).toBe("video/webm");
    expect(mimePourNom("son.m4a")).toBe("audio/mp4");
  });

  it("refuse un format inconnu", () => {
    expect(mimePourNom("archive.zip")).toBeNull();
    expect(mimePourNom("sans-extension")).toBeNull();
  });

  it("distingue les vidéos", () => {
    expect(estVideo("video/mp4")).toBe(true);
    expect(estVideo("audio/mpeg")).toBe(false);
  });

  it("impose des morceaux TUS de 6 Mio", () => {
    expect(TAILLE_MORCEAU_TUS).toBe(6 * 1024 * 1024);
  });
});

describe("cheminPour", () => {
  it("place l'organisation en deuxième segment et nettoie le nom", () => {
    const chemin = cheminPour({
      organizationId: "org-1",
      destination: { type: "import" },
      uuid: "uuid-1",
      nom: "Mon cours été 2026.docx",
    });
    expect(chemin).toBe("org/org-1/imports/uuid-1-Mon-cours-ete-2026.docx");
    expect(chemin.split("/")[1]).toBe("org-1");
  });

  it("range les supports de leçon sous la formation", () => {
    const chemin = cheminPour({
      organizationId: "org-1",
      destination: { type: "lecon", courseId: "c-9", lessonId: "l-3" },
      uuid: "uuid-2",
      nom: "video.mp4",
    });
    expect(chemin).toBe("org/org-1/courses/c-9/uuid-2-video.mp4");
  });

  it("range les extraits d'import sous la formation", () => {
    expect(
      cheminPour({
        organizationId: "org-1",
        destination: { type: "extrait", courseId: "c-9" },
        uuid: "uuid-3",
        nom: "Cours-p12-18.pdf",
      })
    ).toBe("org/org-1/courses/c-9/extraits/uuid-3-Cours-p12-18.pdf");
  });

  it("borne un nom trop long à 100 signes", () => {
    expect(nomSur("a".repeat(300) + ".pdf")).toHaveLength(100);
  });
});

describe("validerDemande", () => {
  const base = {
    destination: { type: "lecon", courseId: "c", lessonId: "l" } as const,
    usageOctets: 0,
    quotaOctets: 20 * Go,
  };

  it("accepte une vidéo de 1,5 Go dans le quota", () => {
    expect(validerDemande({ ...base, nom: "module.mp4", taille: 1.5 * Go })).toBeNull();
  });

  it("refuse un fichier vide", () => {
    expect(validerDemande({ ...base, nom: "vide.pdf", taille: 0 })).toMatch(/vide/);
  });

  it("refuse au-delà de 5 Go", () => {
    const message = validerDemande({ ...base, nom: "gros.mp4", taille: TAILLE_MAX_FICHIER + 1 });
    expect(message).toMatch(/dépasse/);
    expect(message).toMatch(/Go/);
  });

  it("n'accepte que Word, PDF et PowerPoint pour l'import automatique", () => {
    expect(
      validerDemande({ ...base, destination: { type: "import" }, nom: "cours.mp4", taille: 10 })
    ).toMatch(/Word/);
    expect(
      validerDemande({ ...base, destination: { type: "import" }, nom: "cours.pdf", taille: 10 })
    ).toBeNull();
    expect(
      validerDemande({ ...base, destination: { type: "import" }, nom: "cours.pptx", taille: 10 })
    ).toBeNull();
  });

  it("refuse un format inconnu comme support", () => {
    expect(validerDemande({ ...base, nom: "archive.zip", taille: 10 })).toMatch(/Format non pris en charge/);
  });

  it("refuse quand le quota serait dépassé, en nommant les deux tailles", () => {
    const message = validerDemande({
      ...base,
      nom: "module.mp4",
      taille: 3 * Go,
      usageOctets: 18 * Go,
      quotaOctets: 20 * Go,
    });
    expect(message).toMatch(/2 Go disponibles sur 20 Go/);
    expect(message).toMatch(/3 Go/);
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Le bouton « Retour » choisit entre `history.back()` et son lien.
 * Se tromper a deux coûts opposés : soit on fait sortir du site, soit
 * on ignore le chemin réellement parcouru. Les deux signaux sont donc
 * testés séparément, y compris leurs cas dégradés.
 *
 * Le module garde un compteur propre au document ; chaque test
 * réimporte donc une instance neuve.
 */

function poserNavigateur(referrer: string, origin = "https://elite.academy") {
  vi.stubGlobal("document", { referrer } as unknown as Document);
  vi.stubGlobal("window", { location: { origin } } as unknown as Window);
}

async function chargerModule() {
  vi.resetModules();
  return import("@/lib/nav/historique");
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("retourResteDansLApp", () => {
  it("refuse le retour arrière sur un onglet neuf sans provenance", async () => {
    poserNavigateur("");
    const { retourResteDansLApp } = await chargerModule();
    expect(retourResteDansLApp()).toBe(false);
  });

  it("refuse le retour arrière quand on arrive d'un autre site", async () => {
    poserNavigateur("https://mail.google.com/mail/u/0");
    const { retourResteDansLApp } = await chargerModule();
    expect(retourResteDansLApp()).toBe(false);
  });

  it("accepte le retour arrière quand on arrive d'une page du site", async () => {
    poserNavigateur("https://elite.academy/catalogue");
    const { retourResteDansLApp } = await chargerModule();
    expect(retourResteDansLApp()).toBe(true);
  });

  it("compare les origines, pas les préfixes : un domaine voisin est refusé", async () => {
    poserNavigateur("https://elite.academy.attaquant.test/piege");
    const { retourResteDansLApp } = await chargerModule();
    expect(retourResteDansLApp()).toBe(false);
  });

  it("refuse le retour arrière si la provenance est illisible", async () => {
    poserNavigateur("pas-une-url");
    const { retourResteDansLApp } = await chargerModule();
    expect(retourResteDansLApp()).toBe(false);
  });

  it("ne dépend plus de la provenance dès qu'une navigation interne a eu lieu", async () => {
    // Provenance extérieure : sans navigation interne, le retour est refusé.
    poserNavigateur("https://mail.google.com/mail/u/0");
    const { noterChemin, retourResteDansLApp } = await chargerModule();

    noterChemin(); // chargement initial
    expect(retourResteDansLApp()).toBe(false);

    noterChemin(); // première navigation interne
    expect(retourResteDansLApp()).toBe(true);
  });

  it("un seul chemin observé ne suffit pas : c'est le chargement initial", async () => {
    poserNavigateur("");
    const { noterChemin, retourResteDansLApp } = await chargerModule();
    noterChemin();
    expect(retourResteDansLApp()).toBe(false);
  });
});

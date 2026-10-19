import { describe, expect, it } from "vitest";
import { extraireJson, nettoyerReponse, premierBlocEquilibre, reparerJson } from "@/lib/ai/json";

describe("extraireJson – sorties de modèles sans mode JSON garanti", () => {
  it("ignore un bloc de raisonnement <think> (DeepSeek R1, QwQ)", () => {
    const texte = '<think>\nJe réfléchis… {pas du json}\n</think>\n{"title": "Plan"}';
    expect(extraireJson(texte)).toEqual({ title: "Plan" });
  });

  it("accepte une balise de code avec n'importe quel langage", () => {
    expect(extraireJson('```JSON\n{"a": 1}\n```')).toEqual({ a: 1 });
    expect(extraireJson('```\n{"a": 1}\n```')).toEqual({ a: 1 });
  });

  it("tolère de la prose avant et après, même avec des accolades dans le texte", () => {
    const texte = 'Voici le résultat (format {clé: valeur}) :\n{"a": {"b": [1, 2]}}\nFin.';
    expect(extraireJson(texte)).toEqual({ a: { b: [1, 2] } });
  });

  it("ne se laisse pas tromper par des accolades dans les chaînes", () => {
    const texte = '{"text": "Exemple : f(x) = { x + 1 }", "n": 2} et ensuite }';
    expect(extraireJson(texte)).toEqual({ text: "Exemple : f(x) = { x + 1 }", n: 2 });
  });

  it("répare une virgule finale et des guillemets typographiques", () => {
    expect(extraireJson('{"a": [1, 2,], "b": 3,}')).toEqual({ a: [1, 2], b: 3 });
    expect(extraireJson("{“a”: “b”}")).toEqual({ a: "b" });
  });

  it("accepte un tableau à la racine", () => {
    expect(extraireJson("[{\"a\": 1}]")).toEqual([{ a: 1 }]);
  });

  it("renvoie null pour une réponse vide, un refus ou un JSON scalaire", () => {
    expect(extraireJson("")).toBeNull();
    expect(extraireJson("Désolé, je ne peux pas répondre.")).toBeNull();
    expect(extraireJson("42")).toBeNull();
    expect(extraireJson("{invalide}")).toBeNull();
    expect(extraireJson('{"a": 1')).toBeNull();
  });
});

describe("outils de nettoyage", () => {
  it("nettoyerReponse retire balises et blocs think", () => {
    expect(nettoyerReponse("<think>x</think>```json\n{}\n```")).toBe("{}");
  });

  it("premierBlocEquilibre renvoie la première structure complète", () => {
    expect(premierBlocEquilibre('abc {"a": "}"} {"b": 2}')).toBe('{"a": "}"}');
    expect(premierBlocEquilibre("{ oups ]")).toBeNull();
    expect(premierBlocEquilibre("rien")).toBeNull();
  });

  it("reparerJson supprime les virgules finales", () => {
    expect(reparerJson('{"a": 1,}')).toBe('{"a": 1}');
  });
});

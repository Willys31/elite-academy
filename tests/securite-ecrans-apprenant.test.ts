import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

/* ------------------------------------------------------------------
   Lot 26 – garde-fou : aucun écran apprenant ne sélectionne les corrigés
   ni la proposition de l'IA. Les politiques RLS protègent la base ; ce
   test protège le code des pages contre une régression de sélection.
   ------------------------------------------------------------------ */

const RACINE = path.resolve(__dirname, "..", "src", "app", "(app)");
const DOSSIERS_APPRENANT = ["formations", "revision", "progression", "tutorat", "entraide"];
const INTERDITS = ["attempt_ai_reviews", "expected_answer", "explanation"];

function fichiersTsx(dossier: string): string[] {
  if (!fs.existsSync(dossier)) return [];
  const resultat: string[] = [];
  for (const entree of fs.readdirSync(dossier, { withFileTypes: true })) {
    const chemin = path.join(dossier, entree.name);
    if (entree.isDirectory()) resultat.push(...fichiersTsx(chemin));
    else if (entree.name.endsWith("page.tsx")) resultat.push(chemin);
  }
  return resultat;
}

describe("écrans apprenant", () => {
  it("ne lisent ni attempt_ai_reviews, ni expected_answer, ni explanation", () => {
    const fautes: string[] = [];
    for (const d of DOSSIERS_APPRENANT) {
      for (const f of fichiersTsx(path.join(RACINE, d))) {
        const texte = fs.readFileSync(f, "utf8");
        for (const mot of INTERDITS) {
          // Les sélections Supabase sont des chaînes : on cherche le mot dans un .select("…").
          const selections = texte.match(/\.select\(\s*(["'`])[\s\S]*?\1/g) ?? [];
          if (selections.some((s) => s.includes(mot))) fautes.push(`${path.relative(RACINE, f)} sélectionne « ${mot} »`);
        }
      }
    }
    expect(fautes).toEqual([]);
  });

  it("la page d'activité de session ne lit pas non plus la proposition de l'IA", () => {
    const f = path.join(RACINE, "sessions", "[id]", "activite", "[activiteId]", "page.tsx");
    const texte = fs.readFileSync(f, "utf8");
    const selections = texte.match(/\.select\(\s*(["'`])[\s\S]*?\1/g) ?? [];
    for (const mot of INTERDITS) expect(selections.some((s) => s.includes(mot)), mot).toBe(false);
  });
});

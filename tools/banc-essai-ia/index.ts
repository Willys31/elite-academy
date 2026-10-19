/**
 * Banc d'essai comparatif des moteurs IA — lot 25, étape F.
 *
 * Lancement : `npm run banc:ia` (jamais par `npm test` : appels réseau
 * payants). Options :
 *   --simulation          aucun appel réseau : le générateur de démonstration
 *                         joue le rôle du modèle (vérifie le pipeline) ;
 *   --oui                 ne pas demander de confirmation après l'estimation ;
 *   --config a,b          ne lancer que ces configurations (identifiants) ;
 *   --brief x,y           ne lancer que ces briefs ;
 *   --sans-reparation     désactiver la relance de réparation ;
 *   --reprendre           dans le dossier de la date donnée, garder les couples
 *                         déjà réussis et ne rejouer que les échecs ;
 *   --date AAAA-MM-JJ     nom du dossier de résultats (défaut : aujourd'hui).
 *
 * Règles : refuse de tourner sans clé ; affiche le coût estimé avant de
 * démarrer ; n'utilise que des briefs fictifs (aucune donnée
 * d'organisation) ; écrit tout dans `resultats/<date>/`.
 *
 * Ce script n'importe pas `client.ts` (server-only) : il reproduit son
 * câblage avec les mêmes modules purs (`fournisseurs`, `openai-compatible`,
 * `json`, `prompts-plan-v2`, `exemples`, `controle-pedagogique`,
 * `reparation`), ce qui garantit que le banc mesure le même pipeline que
 * l'assistant de création.
 */

import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { nettoyerValeurEnv } from "@/lib/ai/env";
import { resoudreConfiguration, type ConfigurationIa, type LecteurEnv } from "@/lib/ai/fournisseurs";
import { appelerChatCompletions } from "@/lib/ai/openai-compatible";
import { extraireJson } from "@/lib/ai/json";
import { appelerJsonAvecRelances } from "@/lib/ai/appel-json";
import { genererSimulation } from "@/lib/ai/simulation";
import type { BriefGeneration } from "@/lib/ai/prompts";
import { BORNES_EXERCICES_DEFAUT, promptPlan } from "@/lib/ai/prompts-plan-v2";
import { BUDGET_EXEMPLES_DEFAUT, choisirExemples, estimerJetons, formaterExemples } from "@/lib/ai/exemples/selection";
import { controlerPlan, sujetEstCommercial, type Probleme } from "@/lib/ai/controle-pedagogique";
import { genererAvecReparation, type ReponseJsonMinimale, type Verification } from "@/lib/ai/reparation";
import { validerResultat, type ResultatGeneration } from "@/lib/ai/schema";
import { analyserDotenv } from "./dotenv";
import {
  construireRapport,
  estimerAvantLancement,
  estimerCout,
  formaterDuree,
  formaterUsd,
  statistiquesPlan,
  tarifPour,
  type BriefBanc,
  type ConfigurationBanc,
  type EntreeRapport,
  type Tarifs,
} from "./score";

const RACINE = path.resolve(process.cwd(), "tools", "banc-essai-ia");

/* ------------------------------------------------------------------
   Arguments
   ------------------------------------------------------------------ */

interface Arguments {
  simulation: boolean;
  oui: boolean;
  configs: string[] | null;
  briefs: string[] | null;
  reparer: boolean;
  reprendre: boolean;
  date: string;
}

function lireArguments(argv: string[]): Arguments {
  const a: Arguments = {
    simulation: false,
    oui: false,
    configs: null,
    briefs: null,
    reparer: true,
    reprendre: false,
    date: new Date().toISOString().slice(0, 10),
  };
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i];
    if (x === "--simulation") a.simulation = true;
    else if (x === "--oui" || x === "--yes") a.oui = true;
    else if (x === "--sans-reparation") a.reparer = false;
    else if (x === "--reprendre") a.reprendre = true;
    else if (x === "--config") a.configs = (argv[++i] ?? "").split(",").filter(Boolean);
    else if (x === "--brief") a.briefs = (argv[++i] ?? "").split(",").filter(Boolean);
    else if (x === "--date") a.date = argv[++i] ?? a.date;
    else if (x === "--help" || x === "-h") {
      console.log(fs.readFileSync(path.join(RACINE, "index.ts"), "utf8").split("*/")[0]);
      process.exit(0);
    }
  }
  return a;
}

/* ------------------------------------------------------------------
   Lecture des fichiers du banc et de l'environnement
   ------------------------------------------------------------------ */

function lireJson<T>(fichier: string): T {
  return JSON.parse(fs.readFileSync(fichier, "utf8")) as T;
}

function nomFichier(c: ConfigurationBanc, b: BriefBanc): string {
  return `${c.id}__${b.id}.json`;
}

type MesureConservee = Omit<EntreeRapport, "configuration" | "brief">;

/** Couples déjà réussis dans le dossier du jour (option --reprendre). */
function chargerReussis(dossier: string): Map<string, MesureConservee> {
  const reussis = new Map<string, MesureConservee>();
  if (!fs.existsSync(dossier)) return reussis;
  for (const f of fs.readdirSync(dossier).filter((x) => x.includes("__") && x.endsWith(".json"))) {
    try {
      const d = lireJson<{ mesure?: MesureConservee & { ok?: boolean } }>(path.join(dossier, f));
      if (d.mesure?.ok) reussis.set(f, d.mesure);
    } catch {
      /* fichier illisible : on rejouera le couple */
    }
  }
  return reussis;
}

function lecteurEnvironnement(): LecteurEnv {
  const fichier = path.resolve(process.cwd(), ".env.local");
  const local = fs.existsSync(fichier) ? analyserDotenv(fs.readFileSync(fichier, "utf8")) : {};
  return (nom) => nettoyerValeurEnv(process.env[nom] ?? local[nom]);
}

/** Variables vues par `resoudreConfiguration` pour une configuration du banc. */
function envPour(c: ConfigurationBanc, env: LecteurEnv): LecteurEnv {
  // Clé : la variable dédiée (DEEPSEEK_API_KEY…), sinon LLM_API_KEY si
  // l'application est déjà configurée sur ce même fournisseur.
  const cle = env(c.cle_env) || (env("LLM_PROVIDER").trim().toLowerCase() === c.fournisseur ? env("LLM_API_KEY") : "");
  const valeurs: Record<string, string> = {
    LLM_PROVIDER: c.fournisseur,
    LLM_API_KEY: cle,
    LLM_MODEL: c.modele,
    LLM_THINKING: c.thinking,
    LLM_BASE_URL: c.base_url_env ? env(c.base_url_env) : "",
    LLM_MAX_TOKENS: env("LLM_MAX_TOKENS"),
    LLM_TIMEOUT_MS: env("LLM_TIMEOUT_MS") || "600000",
    LLM_JSON_MODE: env("LLM_JSON_MODE"),
  };
  return (nom) => valeurs[nom] ?? "";
}

function briefVersGeneration(b: BriefBanc): BriefGeneration {
  return {
    sujet: b.sujet,
    public_cible: b.public_cible,
    secteur: b.secteur,
    contexte: b.contexte,
    duree: b.duree,
    format: b.format,
    niveau: b.niveau,
    notions_obligatoires: b.notions_obligatoires,
  };
}

/* ------------------------------------------------------------------
   Appel JSON : exactement les relances de `appelerLlmJson` (appel-json.ts)
   ------------------------------------------------------------------ */

function appeleurReel(config: ConfigurationIa, system: string) {
  return (prompt: string): Promise<ReponseJsonMinimale> =>
    appelerJsonAvecRelances(
      (p, relance) =>
        appelerChatCompletions(
          relance.reflexion && config.reflexionPriseEnCharge ? { ...config, reflexion: relance.reflexion } : config,
          { system, prompt: p, json: true },
          (url, init) => fetch(url, init),
          (m) => console.error(m)
        ),
      prompt,
      config,
      (m) => console.error(m)
    );
}

function appeleurSimulation(c: ConfigurationBanc, brief: BriefGeneration, system: string) {
  return async (prompt: string): Promise<ReponseJsonMinimale> => {
    const texte = genererSimulation(brief);
    await new Promise((r) => setTimeout(r, 50));
    return {
      json: extraireJson(texte),
      modele: `${c.modele} (simulation)`,
      fournisseur: c.fournisseur,
      inputTokens: estimerJetons(system + prompt),
      outputTokens: estimerJetons(texte),
      tentatives: 1,
    };
  };
}

/* ------------------------------------------------------------------
   Programme
   ------------------------------------------------------------------ */

async function confirmer(question: string): Promise<boolean> {
  if (!process.stdin.isTTY) {
    console.error("Entrée non interactive : relancez avec --oui pour confirmer le coût estimé.");
    return false;
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const reponse = await new Promise<string>((resolve) => rl.question(question, resolve));
  rl.close();
  return /^(o|oui|y|yes)$/i.test(reponse.trim());
}

async function main() {
  const args = lireArguments(process.argv.slice(2));
  const env = lecteurEnvironnement();
  const tarifs = lireJson<Tarifs>(path.join(RACINE, "tarifs.json"));
  const toutesConfigs = lireJson<{ configurations: ConfigurationBanc[] }>(path.join(RACINE, "configurations.json")).configurations;
  const dossierBriefs = path.join(RACINE, "briefs");
  const briefs = fs
    .readdirSync(dossierBriefs)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => lireJson<BriefBanc>(path.join(dossierBriefs, f)))
    .filter((b) => !args.briefs || args.briefs.includes(b.id));

  const bornes = BORNES_EXERCICES_DEFAUT;

  // Configurations utilisables : actives, filtrées, et avec une clé.
  const retenues: Array<{ banc: ConfigurationBanc; ia: ConfigurationIa | null; motif: string | null }> = [];
  for (const c of toutesConfigs) {
    if (!c.actif && !(args.configs && args.configs.includes(c.id))) continue;
    if (args.configs && !args.configs.includes(c.id)) continue;
    if (args.simulation) {
      retenues.push({ banc: c, ia: null, motif: null });
      continue;
    }
    const r = resoudreConfiguration(envPour(c, env), "conception");
    retenues.push({ banc: c, ia: r.ok ? r.config : null, motif: r.ok ? null : r.erreur });
  }
  const lancables = retenues.filter((r) => args.simulation || r.ia !== null);
  for (const r of retenues.filter((x) => x.motif)) {
    console.log(`⚠ ${r.banc.id} ignorée : ${r.motif} (variable attendue : ${r.banc.cle_env})`);
  }
  if (lancables.length === 0) {
    console.error(
      "Aucune configuration n'a de clé : renseignez DEEPSEEK_API_KEY et/ou GEMINI_API_KEY dans .env.local (ou lancez avec --simulation)."
    );
    process.exit(2);
  }
  if (briefs.length === 0) {
    console.error("Aucun brief à lancer.");
    process.exit(2);
  }

  // Reprise : les couples déjà réussis dans le dossier du jour ne sont pas rejoués.
  const dossier = path.join(RACINE, "resultats", args.date);
  const reussis = args.reprendre ? chargerReussis(dossier) : new Map<string, MesureConservee>();
  if (reussis.size > 0) console.log(`↺ ${reussis.size} couple(s) déjà réussi(s) conservé(s) depuis ${path.relative(process.cwd(), dossier)}`);

  // Estimation avant lancement (couples restant à jouer).
  const couples = lancables
    .flatMap((c) => briefs.map((b) => ({ c, b })))
    .filter(({ c, b }) => !reussis.has(nomFichier(c.banc, b)))
    .map(({ c, b }) => {
      const brief = briefVersGeneration(b);
      const exemples = choisirExemples(b.secteur || b.sujet, BUDGET_EXEMPLES_DEFAUT, { mode: c.banc.exemples });
      const pp = promptPlan("v2", { exemples: formaterExemples(exemples), bornes });
      return { configuration: c.banc, brief: b, entreeJetons: estimerJetons(pp.system + pp.prompt(brief)) };
    });
  const estimation = estimerAvantLancement(couples, tarifs);
  console.log(`\nBanc d'essai IA — ${lancables.length} configuration(s) × ${briefs.length} brief(s) = ${couples.length} génération(s)${args.simulation ? " [SIMULATION]" : ""}`);
  console.log(`Tarifs du ${tarifs.date} (heure pleine). Hypothèses : ${tarifs.hypotheses.sortie_jetons} jetons de sortie, ${Math.round(tarifs.hypotheses.probabilite_reparation * 100)} % de réparation.`);
  for (const l of estimation.lignes) {
    console.log(`  ${l.configuration.padEnd(32)} ${l.brief.padEnd(30)} ~${l.entreeJetons} → ${l.sortieJetons} jetons  ${formaterUsd(l.cout)}`);
  }
  console.log(`Coût total estimé : ${formaterUsd(estimation.total)}${estimation.inconnus.length ? ` (tarif inconnu pour : ${estimation.inconnus.join(", ")})` : ""}`);
  if (!args.simulation && !args.oui) {
    const ok = await confirmer("Lancer les appels payants ? (oui/non) ");
    if (!ok) {
      console.log("Abandon : aucun appel effectué.");
      process.exit(0);
    }
  }

  // Exécution séquentielle (respect des limites de débit).
  fs.mkdirSync(dossier, { recursive: true });
  const entrees: EntreeRapport[] = [];

  for (const c of lancables) {
    for (const b of briefs) {
      const fichier = nomFichier(c.banc, b);
      const conserve = reussis.get(fichier);
      if (conserve) {
        entrees.push({ ...conserve, configuration: c.banc, brief: b });
        console.log(`↺ ${c.banc.id} × ${b.id} : résultat du passage précédent conservé`);
        continue;
      }
      const brief = briefVersGeneration(b);
      const exemples = choisirExemples(b.secteur || b.sujet, BUDGET_EXEMPLES_DEFAUT, { mode: c.banc.exemples });
      const pp = promptPlan("v2", { exemples: formaterExemples(exemples), bornes });
      const sujetCommercial = sujetEstCommercial(brief);
      const verifier = (json: unknown): Verification<ResultatGeneration> => {
        const a = validerResultat(json);
        if (!a.ok) return { ok: false, erreurs: [{ code: "STRUCTURE_INVALIDE", chemin: "$", message: a.erreur }], avertissements: [] };
        const ctl = controlerPlan(a.resultat, { version: "v2", bornes, sujetCommercial });
        return ctl.ok ? { ok: true, valeur: a.resultat, avertissements: ctl.avertissements } : { ok: false, erreurs: ctl.erreurs, avertissements: ctl.avertissements };
      };
      const appeler = args.simulation || !c.ia ? appeleurSimulation(c.banc, brief, pp.system) : appeleurReel(c.ia, pp.system);

      process.stdout.write(`▶ ${c.banc.id} × ${b.id} … `);
      const debut = Date.now();
      let entree: EntreeRapport;
      let dernierJson: unknown = null;
      let erreursFinales: Probleme[] = [];
      try {
        const appelerTrace = async (prompt: string) => {
          const r = await appeler(prompt);
          dernierJson = r.json;
          return r;
        };
        const r = await genererAvecReparation(appelerTrace, pp.prompt(brief), verifier, { reparer: args.reparer });
        const dureeMs = Date.now() - debut;
        const tarif = tarifPour(tarifs, c.banc.modele);
        if (!r.ok) {
          const v = verifier(dernierJson);
          erreursFinales = v.ok ? [] : v.erreurs;
        }
        entree = {
          configuration: c.banc,
          brief: b,
          ok: r.ok,
          erreur: r.ok ? null : r.erreur,
          dureeMs,
          inputTokens: r.bilan.inputTokens,
          outputTokens: r.bilan.outputTokens,
          cout: estimerCout(tarif, r.bilan.inputTokens, r.bilan.outputTokens),
          appels: r.bilan.appels,
          reparee: r.bilan.reparee,
          erreursInitiales: r.bilan.erreursInitiales,
          erreursFinales,
          avertissements: r.ok ? r.avertissements : [],
          statistiques: r.ok ? statistiquesPlan(r.valeur) : null,
          fichier,
        };
        fs.writeFileSync(
          path.join(dossier, fichier),
          JSON.stringify(
            {
              configuration: c.banc,
              brief: b,
              prompt_version: pp.version,
              exemples: exemples.map((e) => e.id),
              mesure: { ...entree, configuration: c.banc.id, brief: b.id },
              resultat: r.ok ? r.valeur : null,
              dernier_json: r.ok ? undefined : dernierJson,
            },
            null,
            2
          )
        );
      } catch (e) {
        const dureeMs = Date.now() - debut;
        const message = e instanceof Error ? e.message : String(e);
        entree = {
          configuration: c.banc,
          brief: b,
          ok: false,
          erreur: message,
          dureeMs,
          inputTokens: null,
          outputTokens: null,
          cout: null,
          appels: 0,
          reparee: false,
          erreursInitiales: [],
          erreursFinales: [],
          avertissements: [],
          statistiques: null,
          fichier,
        };
        fs.writeFileSync(path.join(dossier, fichier), JSON.stringify({ configuration: c.banc, brief: b, erreur: message }, null, 2));
      }
      entrees.push(entree);
      console.log(`${entree.ok ? "✅" : "❌"} ${formaterDuree(entree.dureeMs)} · ${formaterUsd(entree.cout)}${entree.reparee ? " · réparé" : ""}${entree.erreur ? ` · ${entree.erreur.split("\n")[0]}` : ""}`);
    }
  }

  const rapport = construireRapport(entrees, {
    date: args.date,
    simulation: args.simulation,
    tarifsDate: tarifs.date,
    promptVersion: "plan-formation/v2",
    bornes,
  });
  fs.writeFileSync(path.join(dossier, "rapport.md"), rapport);
  fs.writeFileSync(
    path.join(dossier, "resume.json"),
    JSON.stringify(
      entrees.map((e) => ({ ...e, configuration: e.configuration.id, brief: e.brief.id })),
      null,
      2
    )
  );
  const total = entrees.every((e) => e.cout === null) ? null : entrees.reduce((s, e) => s + (e.cout ?? 0), 0);
  console.log(`\nRapport : ${path.relative(process.cwd(), path.join(dossier, "rapport.md"))}`);
  console.log(`Réussites : ${entrees.filter((e) => e.ok).length}/${entrees.length} · coût estimé : ${formaterUsd(total)}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});

/**
 * Découpage de documents en structure de formation – logique pure.
 *
 * Principe (PRD §5 : création à partir d'un document importé) :
 * - Word (.docx) : converti en HTML par mammoth, puis découpé selon
 *   les titres — le niveau de titre le plus haut donne les modules,
 *   le niveau suivant donne les leçons ;
 * - PDF / texte : découpage heuristique par lignes de titre
 *   (numérotation, mots-clés « Module/Chapitre/Partie/Section »,
 *   lignes courtes en majuscules) — fiabilité moindre, signalée ;
 * - PowerPoint : voir `pptx.ts` (sections → modules, diapositives →
 *   leçons), qui réutilise les types et `normaliser` d'ici.
 *
 * Depuis le lot 21, chaque leçon peut porter l'intervalle de pages ou
 * de diapositives dont elle reprend la matière : c'est ce qui permet
 * de joindre à chaque leçon l'extrait du document qui la concerne.
 *
 * Le résultat garantit toujours au moins un module et une leçon,
 * accompagné d'avertissements honnêtes plutôt que d'une fausse
 * structure inventée.
 */

/** Unité de position dans le document source. */
export type UniteSource = "pages" | "slides";

/** Intervalle inclusif de pages ou de diapositives (numérotation à partir de 1). */
export interface Intervalle {
  kind: UniteSource;
  from: number;
  to: number;
}

export interface LeconImportee {
  title: string;
  text: string;
  /** Pages ou diapositives du document dont la leçon reprend la matière. */
  range?: Intervalle;
}

export interface ModuleImporte {
  title: string;
  lessons: LeconImportee[];
}

export interface Decoupage {
  modules: ModuleImporte[];
  warnings: string[];
}

export const MAX_MODULES = 20;
export const MAX_LECONS_PAR_MODULE = 30;
const MAX_TITRE = 200;

export function nettoyerTitre(t: string): string {
  return t.replace(/\s+/g, " ").trim().slice(0, MAX_TITRE);
}

/** Retire les balises HTML et décode les entités courantes. */
function texteDepuisHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

interface Bloc {
  tag: string;
  texte: string;
}

/** Extrait les blocs (titres, paragraphes, éléments de liste) d'un HTML mammoth. */
function extraireBlocs(html: string): Bloc[] {
  const blocs: Bloc[] = [];
  const motif = /<(h1|h2|h3|h4|p|li)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/gi;
  let m: RegExpExecArray | null;
  while ((m = motif.exec(html)) !== null) {
    const texte = texteDepuisHtml(m[2]);
    if (texte) blocs.push({ tag: m[1].toLowerCase(), texte });
  }
  return blocs;
}

/** Structure minimale garantie quand rien n'est découpable. */
export function structureMinimale(
  texte: string,
  warnings: string[],
  range?: Intervalle
): Decoupage {
  return {
    modules: [
      {
        title: "Contenu du document",
        lessons: [
          {
            title: "Document importé",
            text: texte.trim() || "(document vide)",
            ...(range ? { range } : {}),
          },
        ],
      },
    ],
    warnings,
  };
}

export function normaliser(modules: ModuleImporte[], warnings: string[]): Decoupage {
  let liste = modules
    .map((mod) => ({
      title: nettoyerTitre(mod.title) || "Module",
      lessons: mod.lessons
        .map((l) => ({
          title: nettoyerTitre(l.title) || "Leçon",
          text: l.text.trim(),
          ...(l.range ? { range: l.range } : {}),
        }))
        .filter((l) => l.title || l.text)
        .slice(0, MAX_LECONS_PAR_MODULE),
    }))
    .filter((mod) => mod.lessons.length > 0);

  if (liste.length > MAX_MODULES) {
    warnings.push(
      `Le document contient plus de ${MAX_MODULES} modules : seuls les ${MAX_MODULES} premiers ont été importés.`
    );
    liste = liste.slice(0, MAX_MODULES);
  }
  if (liste.length === 0) {
    return structureMinimale("", [
      ...warnings,
      "Aucune structure exploitable n'a été détectée : tout le contenu a été placé dans une seule leçon. Réorganisez-le dans l'éditeur.",
    ]);
  }
  return { modules: liste, warnings };
}

/**
 * Découpe le HTML produit par mammoth (.docx).
 * Titre de plus haut niveau → modules ; niveau suivant → leçons.
 */
export function decouperHtml(html: string): Decoupage {
  const blocs = extraireBlocs(html);
  const warnings: string[] = [];

  if (blocs.length === 0) {
    return structureMinimale(texteDepuisHtml(html), [
      "Le document ne contient aucun contenu lisible.",
    ]);
  }

  const niveaux = ["h1", "h2", "h3", "h4"];
  const presents = niveaux.filter((n) => blocs.some((b) => b.tag === n));

  if (presents.length === 0) {
    return structureMinimale(
      blocs.map((b) => b.texte).join("\n\n"),
      [
        "Le document ne contient aucun titre (styles « Titre 1 », « Titre 2 » de Word) : tout le contenu a été placé dans une seule leçon.",
      ]
    );
  }

  const tagModule = presents[0];
  const tagLecon = presents[1] ?? null;
  if (!tagLecon) {
    warnings.push(
      "Un seul niveau de titre détecté : chaque titre devient un module contenant une leçon unique."
    );
  }

  const modules: ModuleImporte[] = [];
  let moduleCourant: ModuleImporte | null = null;
  let leconCourante: LeconImportee | null = null;
  const preambule: string[] = [];

  const pousserLecon = () => {
    if (moduleCourant && leconCourante) {
      moduleCourant.lessons.push(leconCourante);
      leconCourante = null;
    }
  };

  for (const bloc of blocs) {
    if (bloc.tag === tagModule) {
      pousserLecon();
      moduleCourant = { title: bloc.texte, lessons: [] };
      modules.push(moduleCourant);
      if (!tagLecon) {
        leconCourante = { title: bloc.texte, text: "" };
      }
      continue;
    }
    if (tagLecon && bloc.tag === tagLecon) {
      if (!moduleCourant) {
        moduleCourant = { title: "Introduction", lessons: [] };
        modules.push(moduleCourant);
      }
      pousserLecon();
      leconCourante = { title: bloc.texte, text: "" };
      continue;
    }
    // Contenu courant (paragraphes, listes, titres plus profonds).
    const ligne = bloc.tag === "li" ? `• ${bloc.texte}` : bloc.texte;
    if (leconCourante) {
      leconCourante.text += (leconCourante.text ? "\n\n" : "") + ligne;
    } else if (moduleCourant) {
      leconCourante = { title: "Introduction", text: ligne };
    } else {
      preambule.push(ligne);
    }
  }
  pousserLecon();

  // Contenu avant le premier titre → leçon d'introduction en tête.
  if (preambule.length > 0 && modules.length > 0) {
    modules.unshift({
      title: "Avant-propos",
      lessons: [{ title: "Avant-propos", text: preambule.join("\n\n") }],
    });
  }

  return normaliser(modules, warnings);
}

/**
 * Convertit le HTML mammoth en texte balisé lisible par un LLM :
 * les titres deviennent des lignes « # / ## / ### », les éléments de
 * liste des puces. Préserve la structure sans le bruit du HTML.
 */
export function htmlVersTexte(html: string): string {
  const prefixes: Record<string, string> = {
    h1: "# ",
    h2: "## ",
    h3: "### ",
    h4: "#### ",
    li: "- ",
    p: "",
  };
  return extraireBlocs(html)
    .map((b) => `${prefixes[b.tag] ?? ""}${b.texte}`)
    .join("\n\n");
}

/** Une ligne ressemble-t-elle à un titre de module (texte brut) ? */
function estTitreModule(ligne: string): boolean {
  const l = ligne.trim();
  if (l.length === 0 || l.length > 90) return false;
  if (/^(module|chapitre|partie|section)\s+\d+/i.test(l)) return true;
  if (/^\d+[.)]\s+\S/.test(l) && !/^\d+\.\d+/.test(l)) return true;
  // Ligne courte tout en majuscules (au moins 3 lettres).
  const lettres = l.replace(/[^A-ZÀ-ÖØ-Þa-zà-öø-þ]/g, "");
  if (
    lettres.length >= 3 &&
    l === l.toUpperCase() &&
    /[A-ZÀ-ÖØ-Þ]/.test(l) &&
    l.split(/\s+/).length <= 10
  ) {
    return true;
  }
  return false;
}

/** Une ligne ressemble-t-elle à un titre de leçon (sous-niveau) ? */
function estTitreLecon(ligne: string): boolean {
  const l = ligne.trim();
  if (l.length === 0 || l.length > 90) return false;
  return /^\d+\.\d+[.)]?\s+\S/.test(l);
}

// ------------------------------------------------------------
// Positions dans le document source (lot 21)
// ------------------------------------------------------------

/**
 * Ligne-repère insérée avant chaque page d'un PDF : « [[PAGE 12]] ».
 * Elle n'est jamais du contenu — le découpage la consomme pour savoir
 * sur quelle page il se trouve, et l'IA reçoit pour consigne de ne
 * jamais la recopier.
 */
export const MARQUEUR_PAGE = /^\[\[PAGE (\d+)\]\]$/;

/** Repère d'une diapositive : « [[DIAPOSITIVE 5 : Titre]] ». */
export const MARQUEUR_DIAPOSITIVE = /^\[\[DIAPOSITIVE (\d+)(?: : [^\]]*)?\]\]$/;

/** Toute ligne-repère, pour le nettoyage défensif des textes renvoyés par l'IA. */
const MARQUEUR_QUELCONQUE = /^\[\[(?:PAGE|DIAPOSITIVE) \d+[^\]]*\]\]\s*$/gm;

/**
 * Texte d'un PDF reconstruit page par page, avec un repère avant
 * chaque page. Remplace le `text` global de pdf-parse, dont les
 * séparateurs « -- 3 of 12 -- » se retrouvaient dans les leçons.
 */
export function texteAvecMarqueursPages(pages: Array<{ num: number; text: string }>): string {
  return pages.map((p) => `[[PAGE ${p.num}]]\n${p.text.trim()}`).join("\n");
}

/** Retire les lignes-repères d'un texte (réponse IA peu scrupuleuse). */
export function retirerMarqueurs(texte: string): string {
  return texte.replace(MARQUEUR_QUELCONQUE, "").replace(/\n{3,}/g, "\n\n").trim();
}

/** « Pages 12 à 18 », « Page 7 », « Diapositives 20 à 31 ». */
export function libelleIntervalle(i: Intervalle): string {
  const unite = i.kind === "pages" ? "Page" : "Diapositive";
  return i.from === i.to ? `${unite} ${i.from}` : `${unite}s ${i.from} à ${i.to}`;
}

/** « p. 12–18 », « diapo 20–31 ». */
export function libelleCourt(i: Intervalle): string {
  const unite = i.kind === "pages" ? "p." : "diapo";
  return i.from === i.to ? `${unite} ${i.from}` : `${unite} ${i.from}–${i.to}`;
}

/**
 * Réunion de deux intervalles de même nature, contigus ou se
 * chevauchant. `null` sinon : fusionner des leçons issues de pages
 * éloignées ne donnerait pas un extrait sensé.
 */
export function unionIntervalles(a: Intervalle, b: Intervalle): Intervalle | null {
  if (a.kind !== b.kind) return null;
  const [premier, second] = a.from <= b.from ? [a, b] : [b, a];
  if (second.from > premier.to + 1) return null;
  return { kind: a.kind, from: premier.from, to: Math.max(premier.to, second.to) };
}

function normaliserPourRecherche(t: string): string {
  return t
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Repli quand l'IA n'a pas indiqué les pages d'une leçon : on cherche
 * dans quelles unités (pages ou diapositives) se trouvent le début et
 * la fin de son texte. Deux repères trouvés → intervalle ; un seul →
 * une unité ; aucun → `null` (la leçon n'aura pas d'extrait).
 */
export function deduireIntervalle(
  texteLecon: string,
  unites: string[],
  kind: UniteSource
): Intervalle | null {
  const texte = normaliserPourRecherche(texteLecon);
  if (texte.length < 20) return null;
  const debut = texte.slice(0, 60);
  const fin = texte.slice(-60);
  const normalisees = unites.map(normaliserPourRecherche);

  const chercher = (fragment: string): number | null => {
    for (let i = 0; i < normalisees.length; i++) {
      if (normalisees[i].includes(fragment)) return i + 1;
    }
    return null;
  };

  const a = chercher(debut);
  const b = chercher(fin);
  if (a === null && b === null) return null;
  const bornes = [a, b].filter((n): n is number => n !== null);
  return { kind, from: Math.min(...bornes), to: Math.max(...bornes) };
}

/**
 * Découpe un texte brut (extraction PDF) — heuristique, fiabilité
 * moindre : un avertissement est toujours ajouté.
 *
 * Si le texte contient des repères `[[PAGE n]]` (voir
 * `texteAvecMarqueursPages`), chaque leçon reçoit l'intervalle de
 * pages dont elle reprend la matière. Deux leçons voisines peuvent
 * partager leur page frontière : l'extrait est à l'unité de la page.
 */
export function decouperTexte(texte: string): Decoupage {
  const warnings = [
    "Import depuis un PDF : la structure a été devinée à partir du texte (numérotation, titres en majuscules). Vérifiez le découpage dans l'éditeur — les pages correspondantes sont jointes à chaque leçon.",
  ];

  const lignesBrutes = texte
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  let dernierePage = 0;
  for (const l of lignesBrutes) {
    const m = MARQUEUR_PAGE.exec(l);
    if (m) dernierePage = Math.max(dernierePage, Number(m[1]));
  }
  const avecPages = dernierePage > 0;
  const lignes = lignesBrutes.filter((l) => !MARQUEUR_PAGE.test(l));
  const intervalleTotal: Intervalle | undefined = avecPages
    ? { kind: "pages", from: 1, to: dernierePage }
    : undefined;

  if (lignes.length === 0) {
    return structureMinimale(
      "",
      [...warnings, "Aucun texte n'a pu être extrait de ce PDF (document scanné ou protégé ?)."],
      intervalleTotal
    );
  }

  const modules: ModuleImporte[] = [];
  let moduleCourant: ModuleImporte | null = null;
  let leconCourante: LeconImportee | null = null;
  let pageCourante = 1;

  const pousserLecon = () => {
    if (moduleCourant && leconCourante) {
      moduleCourant.lessons.push(leconCourante);
      leconCourante = null;
    }
  };
  const nouvelleLecon = (title: string, text: string): LeconImportee => ({
    title,
    text,
    ...(avecPages ? { range: { kind: "pages" as const, from: pageCourante, to: pageCourante } } : {}),
  });
  const etendre = (l: LeconImportee) => {
    if (l.range) l.range.to = Math.max(l.range.to, pageCourante);
  };

  for (const ligne of lignesBrutes) {
    const marqueur = MARQUEUR_PAGE.exec(ligne);
    if (marqueur) {
      pageCourante = Number(marqueur[1]);
      continue;
    }
    if (estTitreLecon(ligne) && moduleCourant) {
      pousserLecon();
      leconCourante = nouvelleLecon(ligne, "");
      continue;
    }
    if (estTitreModule(ligne)) {
      pousserLecon();
      moduleCourant = { title: ligne, lessons: [] };
      modules.push(moduleCourant);
      leconCourante = nouvelleLecon(ligne, "");
      continue;
    }
    if (leconCourante) {
      leconCourante.text += (leconCourante.text ? "\n" : "") + ligne;
      etendre(leconCourante);
    } else {
      moduleCourant = { title: "Introduction", lessons: [] };
      modules.push(moduleCourant);
      leconCourante = nouvelleLecon("Introduction", ligne);
    }
  }
  pousserLecon();

  if (modules.length <= 1 && (modules[0]?.lessons.length ?? 0) <= 1) {
    return structureMinimale(
      lignes.join("\n"),
      [...warnings, "Aucune structure claire détectée : tout le contenu a été placé dans une seule leçon."],
      intervalleTotal
    );
  }
  return normaliser(modules, warnings);
}

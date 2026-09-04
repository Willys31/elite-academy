/**
 * Découpage de documents en structure de formation – logique pure.
 *
 * Principe (PRD §5 : création à partir d'un document importé) :
 * - Word (.docx) : converti en HTML par mammoth, puis découpé selon
 *   les titres — le niveau de titre le plus haut donne les modules,
 *   le niveau suivant donne les leçons ;
 * - PDF / texte : découpage heuristique par lignes de titre
 *   (numérotation, mots-clés « Module/Chapitre/Partie/Section »,
 *   lignes courtes en majuscules) — fiabilité moindre, signalée.
 *
 * Le résultat garantit toujours au moins un module et une leçon,
 * accompagné d'avertissements honnêtes plutôt que d'une fausse
 * structure inventée.
 */

export interface LeconImportee {
  title: string;
  text: string;
}

export interface ModuleImporte {
  title: string;
  lessons: LeconImportee[];
}

export interface Decoupage {
  modules: ModuleImporte[];
  warnings: string[];
}

const MAX_MODULES = 20;
const MAX_LECONS_PAR_MODULE = 30;
const MAX_TITRE = 200;

function nettoyerTitre(t: string): string {
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
function structureMinimale(texte: string, warnings: string[]): Decoupage {
  return {
    modules: [
      {
        title: "Contenu du document",
        lessons: [
          {
            title: "Document importé",
            text: texte.trim() || "(document vide)",
          },
        ],
      },
    ],
    warnings,
  };
}

function normaliser(modules: ModuleImporte[], warnings: string[]): Decoupage {
  let liste = modules
    .map((mod) => ({
      title: nettoyerTitre(mod.title) || "Module",
      lessons: mod.lessons
        .map((l) => ({
          title: nettoyerTitre(l.title) || "Leçon",
          text: l.text.trim(),
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

/**
 * Découpe un texte brut (extraction PDF) — heuristique, fiabilité
 * moindre : un avertissement est toujours ajouté.
 */
export function decouperTexte(texte: string): Decoupage {
  const warnings = [
    "Import depuis un PDF : la structure a été devinée à partir du texte (numérotation, titres en majuscules). Vérifiez le découpage dans l'éditeur — le document original est joint en support.",
  ];

  const lignes = texte
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lignes.length === 0) {
    return structureMinimale("", [
      ...warnings,
      "Aucun texte n'a pu être extrait de ce PDF (document scanné ou protégé ?).",
    ]);
  }

  const modules: ModuleImporte[] = [];
  let moduleCourant: ModuleImporte | null = null;
  let leconCourante: LeconImportee | null = null;

  const pousserLecon = () => {
    if (moduleCourant && leconCourante) {
      moduleCourant.lessons.push(leconCourante);
      leconCourante = null;
    }
  };

  for (const ligne of lignes) {
    if (estTitreLecon(ligne) && moduleCourant) {
      pousserLecon();
      leconCourante = { title: ligne, text: "" };
      continue;
    }
    if (estTitreModule(ligne)) {
      pousserLecon();
      moduleCourant = { title: ligne, lessons: [] };
      modules.push(moduleCourant);
      leconCourante = { title: ligne, text: "" };
      continue;
    }
    if (leconCourante) {
      leconCourante.text += (leconCourante.text ? "\n" : "") + ligne;
    } else {
      moduleCourant = { title: "Introduction", lessons: [] };
      modules.push(moduleCourant);
      leconCourante = { title: "Introduction", text: ligne };
    }
  }
  pousserLecon();

  if (modules.length <= 1 && (modules[0]?.lessons.length ?? 0) <= 1) {
    return structureMinimale(lignes.join("\n"), [
      ...warnings,
      "Aucune structure claire détectée : tout le contenu a été placé dans une seule leçon.",
    ]);
  }
  return normaliser(modules, warnings);
}

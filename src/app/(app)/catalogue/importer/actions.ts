"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/profile";
import { canCreateCourse, slugify } from "@/lib/courses/statuts";
import {
  decouperHtml,
  decouperTexte,
  deduireIntervalle,
  htmlVersTexte,
  libelleIntervalle,
  texteAvecMarqueursPages,
  type Decoupage,
  type Intervalle,
  type UniteSource,
} from "@/lib/import/decoupage";
import { ouvrirDecoupeurPdf, ouvrirDecoupeurPptx } from "@/lib/import/extraits";
import { rattacherExtrait } from "@/lib/import/rattachement";
import { appelerLlm, iaConfiguree, modeleConfigure, modeSimulation } from "@/lib/ai/client";
import {
  construirePromptStructuration,
  PROMPT_VERSION_IMPORT,
  SYSTEM_IMPORT,
} from "@/lib/ai/prompts";
import { extraireJson, validerResultat, type ResultatGeneration } from "@/lib/ai/schema";
import { verifierEdition } from "@/lib/stockage/edition";
import {
  extensionDe,
  formaterTaille,
  TAILLE_MAX_EXTRACTION,
} from "@/lib/stockage/limites";
import type { ActionState } from "@/app/(app)/catalogue/actions";

/** Taille maximale du texte envoyé à l'IA (≈ 30 000 jetons). */
const MAX_TEXTE_IA = 120000;

function loguer(contexte: string, error: unknown) {
  const message =
    error instanceof Error ? error.message : (error as { message?: string })?.message;
  if (message) console.error(`[import] ${contexte} :`, message);
}

// ------------------------------------------------------------
// Analyseurs de documents – chargés à la demande
//
// `mammoth` et `pdf-parse` ne servent qu'au moment d'analyser un
// fichier téléversé. Importés en tête de module, ils étaient évalués au
// simple rendu des pages qui référencent ce fichier (« Importer un
// document » et l'éditeur de formation) : en production, leur
// chargement échouait et renvoyait une 500 avant même le contrôle
// d'authentification. Chargés ici, une défaillance de l'analyseur
// devient un message d'erreur au téléversement, jamais une page morte.
//
// Ces deux paquets restent déclarés dans `serverExternalPackages`
// (next.config.ts) : webpack casse le worker pdfjs minifié.
// ------------------------------------------------------------

/**
 * Résultat d'une analyse : texte balisé pour l'IA, découpage par
 * titres, et — pour les formats paginés — le texte de chaque unité
 * (page ou diapositive) pour retrouver les positions des leçons.
 */
interface Analyse {
  texte: string;
  decoupage: Decoupage;
  unites: string[];
  kind: UniteSource | null;
  total: number;
}

async function chargerAnalyseurDocx() {
  const mammoth = (await import("mammoth")).default;
  return async (contenu: Buffer): Promise<Analyse> => {
    const { value: html } = await mammoth.convertToHtml({ buffer: contenu });
    return {
      texte: htmlVersTexte(html),
      decoupage: decouperHtml(html),
      unites: [],
      kind: null,
      total: 0,
    };
  };
}

async function chargerAnalyseurPdf() {
  const { PDFParse } = await import("pdf-parse");
  return async (contenu: Buffer): Promise<Analyse> => {
    const analyseur = new PDFParse({ data: contenu });
    try {
      const resultat = await analyseur.getText();
      const pages = resultat.pages.map((p) => ({ num: p.num, text: p.text }));
      // Texte reconstruit page par page, avec repères : les leçons
      // connaissent ainsi leurs pages, et les séparateurs « -- 3 of 12 -- »
      // de pdf-parse ne polluent plus leur contenu.
      const texte = texteAvecMarqueursPages(pages);
      return {
        texte,
        decoupage: decouperTexte(texte),
        unites: pages.map((p) => p.text),
        kind: "pages",
        total: resultat.total || pages.length,
      };
    } finally {
      await analyseur.destroy();
    }
  };
}

async function chargerAnalyseurPptx(nomFichier: string) {
  const { lirePresentation, diapositivesVersTexte, decouperDiapositives } = await import(
    "@/lib/import/pptx"
  );
  return async (contenu: Buffer): Promise<Analyse> => {
    const presentation = await lirePresentation(new Uint8Array(contenu));
    return {
      texte: diapositivesVersTexte(presentation),
      decoupage: decouperDiapositives(presentation, nomFichier),
      unites: presentation.diapositives.map((d) => [d.titre, d.texte, d.notes].join("\n")),
      kind: "slides",
      total: presentation.total,
    };
  };
}

// ------------------------------------------------------------
// Import d'un document de cours → formation en brouillon
//
// Depuis le lot 20, le document est d'abord déposé directement dans
// Storage par le navigateur (composant `TeleverseurFichier`), puis
// finalisé : cette action ne reçoit que l'identifiant de la source et
// télécharge le fichier depuis le bucket pour en extraire le texte.
// ------------------------------------------------------------

export async function importerDocument(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await getCurrentUser();
  if (!user) return { error: "Vous devez être connecté." };

  const organizationId = String(formData.get("organization_id") ?? "");
  const titreSaisi = String(formData.get("title") ?? "").trim();
  const sourceId = String(formData.get("source_id") ?? "");

  if (!organizationId) return { error: "Veuillez choisir une organisation." };
  if (!sourceId) {
    return { error: "Veuillez d'abord téléverser le document de cours à importer." };
  }
  if (!canCreateCourse(user.memberships, organizationId)) {
    return { error: "Vous n'avez pas le droit de créer une formation dans cette organisation." };
  }

  const supabase = await createClient();
  const { data: source } = await supabase
    .from("sources")
    .select("id, organization_id, owner_id, title, file_path, mime_type, upload_status, size_bytes")
    .eq("id", sourceId)
    .maybeSingle();

  if (!source || source.owner_id !== user.id || source.organization_id !== organizationId) {
    return { error: "Document téléversé introuvable. Recommencez le téléversement." };
  }
  if (source.upload_status !== "ready") {
    return { error: "Le téléversement du document n'est pas terminé. Patientez puis réessayez." };
  }

  const fichier = { name: source.title };
  const ext = extensionDe(fichier.name);
  if (ext !== ".docx" && ext !== ".pdf" && ext !== ".pptx") {
    return {
      error:
        "Formats acceptés pour l'import automatique : Word (.docx), PDF ou PowerPoint (.pptx). Les autres formats peuvent être ajoutés comme supports dans l'éditeur.",
    };
  }

  /* Le fichier est lu en mémoire dans la fonction serveur pour en
     extraire le texte : au-delà de la limite, il reste disponible comme
     support de leçon (déjà stocké), sans analyse automatique. */
  const taille = Number(source.size_bytes ?? 0);
  if (taille > TAILLE_MAX_EXTRACTION) {
    return {
      error:
        `Pour l'import automatique, le document doit faire moins de ${formaterTaille(TAILLE_MAX_EXTRACTION)} ` +
        `(celui-ci fait ${formaterTaille(taille)}). Il reste disponible dans vos sources et peut être joint ` +
        "comme support à une leçon.",
    };
  }

  const { data: blob, error: erreurTelechargement } = await supabase.storage
    .from("supports")
    .download(source.file_path);
  if (erreurTelechargement || !blob) {
    loguer("téléchargement du document", erreurTelechargement);
    return { error: "Le document n'a pas pu être relu depuis le stockage. Réessayez." };
  }

  // 1. Extraction du contenu (texte balisé pour l'IA + découpage
  // par titres, qui sert de mode simple et de repli).
  const mode = String(formData.get("mode") ?? "ia");
  const contenu = Buffer.from(await blob.arrayBuffer());
  let texteBrut = "";
  let decoupage: Decoupage;
  let unites: string[] = [];
  let kind: UniteSource | null = null;
  let total = 0;

  // Chargement de l'analyseur, séparé de l'analyse elle-même : un
  // module indisponible et un fichier illisible n'ont ni la même cause
  // ni le même remède, ils ne doivent pas donner le même message.
  let analyser: (contenu: Buffer) => Promise<Analyse>;
  try {
    analyser =
      ext === ".docx"
        ? await chargerAnalyseurDocx()
        : ext === ".pptx"
          ? await chargerAnalyseurPptx(fichier.name)
          : await chargerAnalyseurPdf();
  } catch (e) {
    loguer("chargement de l'analyseur de documents", e);
    return {
      error:
        "L'analyseur de documents n'a pas pu être chargé sur le serveur. " +
        "Créez la formation manuellement et joignez le fichier en support ; " +
        "signalez l'incident si le problème persiste.",
    };
  }

  try {
    const resultat = await analyser(contenu);
    texteBrut = resultat.texte;
    decoupage = resultat.decoupage;
    unites = resultat.unites;
    kind = resultat.kind;
    total = resultat.total;
  } catch (e) {
    loguer("analyse du document", e);
    return {
      error:
        "Le document n'a pas pu être lu (fichier corrompu ou protégé ?). Vous pouvez quand même créer la formation manuellement et joindre le fichier en support.",
    };
  }

  // 2. Le document original est déjà stocké et tracé dans `sources`
  // (traçabilité, PRD §17) : la finalisation du téléversement s'en est
  // chargée avant l'appel de cette action. Il devient « document
  // d'import » : il n'est plus joint tel quel aux leçons (lot 21), ce
  // sont ses extraits qui le sont ; `supprimerSource` le protège tant
  // que des leçons y renvoient.
  const stocke = { chemin: source.file_path, sourceId: source.id };
  await supabase.from("sources").update({ source_type: "document_import" }).eq("id", source.id);

  // 2 bis. Structuration par IA (mode recommandé) : réorganisation
  // fidèle du contenu + extraction des QCM/exercices, tracée dans
  // ai_generations. En simulation, repli honnête sur les titres.
  let resultatIa: ResultatGeneration | null = null;
  let generationId: string | null = null;
  const avertissements: string[] = [];

  if (mode === "ia" && modeSimulation()) {
    avertissements.push(
      "Mode simulation actif : découpage par titres utilisé à la place de l'IA. Configurez un fournisseur IA (gratuit possible : LLM_PROVIDER=gemini) pour la structuration intelligente."
    );
  } else if (mode === "ia") {
    if (!iaConfiguree()) {
      return {
        error:
          "Aucune IA configurée. Dans .env.local : LLM_PROVIDER=gemini + LLM_API_KEY (gratuit), ou ANTHROPIC_API_KEY, ou ELITE_IA_MODE=simulation — ou choisissez le découpage par titres ci-dessous.",
      };
    }
    let texte = texteBrut;
    if (texte.length > MAX_TEXTE_IA) {
      texte = texte.slice(0, MAX_TEXTE_IA);
      avertissements.push(
        "Document très long : seuls les premiers ~120 000 caractères ont été analysés par l'IA. Découpez le document pour un import complet."
      );
    }

    const { data: generation } = await supabase
      .from("ai_generations")
      .insert({
        organization_id: organizationId,
        requested_by: user.id,
        generation_type: "document_structuring",
        brief: { fichier: fichier.name, mode: "import_ia", unite: kind, total },
        context: { source: "import_document" },
        source_ids: [stocke.sourceId],
        prompt_version: PROMPT_VERSION_IMPORT,
        model_name: modeleConfigure(),
        status: "running",
      })
      .select("id")
      .single();
    generationId = generation?.id ?? null;

    const echecIa = async (message: string) => {
      if (generationId) {
        await supabase
          .from("ai_generations")
          .update({
            status: "failed",
            error_message: message,
            completed_at: new Date().toISOString(),
          })
          .eq("id", generationId);
      }
    };

    try {
      const reponse = await appelerLlm(
        SYSTEM_IMPORT,
        construirePromptStructuration(
          fichier.name,
          texte,
          kind ? { type: kind === "pages" ? "page" : "diapositive", total } : undefined
        )
      );
      const analyse = validerResultat(extraireJson(reponse.texte), {
        totalUnites: kind ? total : undefined,
      });
      if (!analyse.ok) {
        await echecIa(analyse.erreur);
        return {
          error: `${analyse.erreur} Relancez l'import, ou choisissez le découpage par titres.`,
        };
      }
      resultatIa = analyse.resultat;
      if (generationId) {
        await supabase
          .from("ai_generations")
          .update({
            status: "succeeded",
            result: resultatIa as unknown as Record<string, unknown>,
            model_name: reponse.modele,
            input_tokens: reponse.inputTokens,
            output_tokens: reponse.outputTokens,
            completed_at: new Date().toISOString(),
          })
          .eq("id", generationId);
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : "Échec de l'appel au service IA.";
      loguer("structuration IA", e);
      await echecIa(message);
      return { error: `${message} Vous pouvez relancer, ou choisir le découpage par titres.` };
    }
  }

  // 3. Création de la formation en brouillon.
  const titre =
    titreSaisi ||
    resultatIa?.course.title ||
    fichier.name.replace(/\.(docx|pdf|pptx)$/i, "").replace(/[-_]+/g, " ").trim();
  const base = slugify(titre);
  let slug = base;
  for (let i = 2; i <= 20; i++) {
    const { data: existant } = await supabase
      .from("courses")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("slug", slug)
      .maybeSingle();
    if (!existant) break;
    slug = `${base}-${i}`;
  }

  const notes = [
    ...(resultatIa ? resultatIa.warnings : decoupage.warnings),
    ...avertissements,
  ];
  let description: string;
  if (resultatIa) {
    description = resultatIa.course.description || `Formation structurée par IA depuis « ${fichier.name} ».`;
    if (resultatIa.course.objectives.length > 0) {
      description += `\n\nObjectifs pédagogiques :\n${resultatIa.course.objectives
        .map((o) => `- ${o}`)
        .join("\n")}`;
    }
  } else {
    description = `Formation créée par import du document « ${fichier.name} ».`;
  }
  if (notes.length > 0) {
    description += `\n\nNotes d'import :\n${notes.map((w) => `- ${w}`).join("\n")}`;
  }

  const { data: course, error: erreurCourse } = await supabase
    .from("courses")
    .insert({
      organization_id: organizationId,
      owner_id: user.id,
      title: titre,
      slug,
      description,
      target_audience: resultatIa?.course.target_audience || null,
      prerequisites: resultatIa?.course.prerequisites || null,
      duration_minutes: resultatIa?.course.duration_minutes ?? null,
      context_type: "organization",
      format: "online",
      status: "draft",
    })
    .select("id")
    .single();
  if (erreurCourse || !course) {
    loguer("création de la formation", erreurCourse);
    return { error: "Le document est importé mais la formation n'a pas pu être créée." };
  }

  if (generationId) {
    await supabase
      .from("ai_generations")
      .update({ result_course_id: course.id })
      .eq("id", generationId);
  }

  const { data: version } = await supabase
    .from("course_versions")
    .insert({
      course_id: course.id,
      version_number: 1,
      change_summary: resultatIa
        ? `Importée et structurée par IA depuis « ${fichier.name} » (${PROMPT_VERSION_IMPORT})`
        : `Importée depuis « ${fichier.name} »`,
      created_by: user.id,
      status: "draft",
    })
    .select("id")
    .single();

  // 4. Modules, leçons — et, en mode IA, QCM extraits du document.
  const leconsAvecExtrait: Array<{ id: string; range: Intervalle }> = [];
  const avertissementsExtraits: string[] = [];
  if (version) {
    await supabase
      .from("courses")
      .update({ current_version_id: version.id })
      .eq("id", course.id);

    /* Position de chaque leçon dans le document : fournie par l'IA
       (`source_range`), sinon retrouvée en cherchant le début et la fin
       de son texte dans les pages ou diapositives ; sinon la leçon n'a
       pas d'extrait et on le dit. */
    const intervalleIa = (l: { title: string; text: string; source_range: { from: number; to: number } | null }): Intervalle | undefined => {
      if (!kind) return undefined;
      if (l.source_range) return { kind, from: l.source_range.from, to: l.source_range.to };
      const deduit = deduireIntervalle(l.text, unites, kind);
      if (!deduit) {
        avertissementsExtraits.push(
          `${kind === "pages" ? "Pages" : "Diapositives"} non identifiées pour la leçon « ${l.title} » : aucun extrait joint. Indiquez-les depuis l'éditeur.`
        );
        return undefined;
      }
      return deduit;
    };

    const modulesACreer = resultatIa
      ? resultatIa.modules.map((m) => ({
          title: m.title,
          description: m.description || null,
          lessons: m.lessons.map((l) => ({
            title: l.title,
            text: l.text,
            estimated_minutes: l.estimated_minutes,
            quiz: l.quiz,
            range: intervalleIa(l),
          })),
        }))
      : decoupage.modules.map((m) => ({
          title: m.title,
          description: null as string | null,
          lessons: m.lessons.map((l) => ({
            title: l.title,
            text: l.text,
            estimated_minutes: null as number | null,
            quiz: null,
            range: l.range,
          })),
        }));

    for (const [i, mod] of modulesACreer.entries()) {
      const { data: moduleCree } = await supabase
        .from("modules")
        .insert({
          course_version_id: version.id,
          title: mod.title,
          description: mod.description,
          position: i + 1,
          status: "draft",
        })
        .select("id")
        .single();
      if (!moduleCree) continue;

      for (const [j, lecon] of mod.lessons.entries()) {
        const { data: leconCreee } = await supabase
          .from("lessons")
          .insert({
            module_id: moduleCree.id,
            title: lecon.title,
            content: {
              type: "text",
              text: lecon.text,
              imported: true,
              ...(lecon.range && kind
                ? {
                    source: {
                      source_id: source.id,
                      kind,
                      from: lecon.range.from,
                      to: lecon.range.to,
                      total,
                    },
                  }
                : {}),
            },
            position: j + 1,
            estimated_minutes: lecon.estimated_minutes,
            status: "draft",
          })
          .select("id")
          .single();
        if (!leconCreee) continue;
        if (lecon.range) leconsAvecExtrait.push({ id: leconCreee.id, range: lecon.range });

        // QCM détecté dans le document → activité quiz + questions.
        if (lecon.quiz) {
          const { data: activite } = await supabase
            .from("activities")
            .insert({
              lesson_id: leconCreee.id,
              type: "quiz",
              title: lecon.quiz.title,
              generated_by_ai: true,
              position: 1,
              status: "draft",
            })
            .select("id")
            .single();
          if (activite) {
            await supabase.from("questions").insert(
              lecon.quiz.questions.map((q, k) => ({
                activity_id: activite.id,
                type: "qcm",
                prompt: q.prompt,
                options: q.options,
                expected_answer: { index: q.correct_index },
                explanation: q.explanation,
                position: k + 1,
              }))
            );
          }
        }
      }
    }
  }

  // 4 bis. Compétences identifiées par l'IA : réutiliser celles qui
  // existent déjà dans l'organisation, créer les autres, puis lier.
  if (resultatIa) {
    for (const comp of resultatIa.competencies) {
      const { data: existante } = await supabase
        .from("competencies")
        .select("id")
        .eq("organization_id", organizationId)
        .ilike("name", comp.name)
        .maybeSingle();

      let competencyId = existante?.id as string | undefined;
      if (!competencyId) {
        const { data: creee } = await supabase
          .from("competencies")
          .insert({
            organization_id: organizationId,
            name: comp.name,
            domain: comp.domain,
            description: comp.description || null,
          })
          .select("id")
          .single();
        competencyId = creee?.id;
      }
      if (competencyId) {
        await supabase.from("course_competencies").upsert(
          { course_id: course.id, competency_id: competencyId, target_level: comp.target_level },
          { onConflict: "course_id,competency_id" }
        );
      }
    }
  }

  // 5. Chaque leçon reçoit l'extrait du document qui la concerne
  // (pages du PDF, diapositives du PowerPoint). Le découpeur est ouvert
  // une seule fois ; un extrait qui échoue (quota, fichier protégé)
  // n'empêche pas l'import : la leçon garde sa position et l'éditeur
  // propose de régénérer l'extrait.
  if (kind && leconsAvecExtrait.length > 0) {
    const octets = new Uint8Array(contenu);
    let decoupeur: Awaited<ReturnType<typeof ouvrirDecoupeurPdf>> | null = null;
    try {
      decoupeur = kind === "pages" ? await ouvrirDecoupeurPdf(octets) : await ouvrirDecoupeurPptx(octets);
    } catch (e) {
      loguer("ouverture du document pour les extraits", e);
      avertissementsExtraits.push(
        "Le document n'a pas pu être découpé en extraits (fichier protégé ou corrompu ?) : les leçons sont créées sans pièce jointe."
      );
    }
    if (decoupeur) {
      const ctx = {
        supabase,
        userId: user.id,
        organizationId,
        courseId: course.id,
      };
      const original = {
        id: source.id,
        title: source.title,
        file_path: source.file_path,
        mime_type: source.mime_type,
        kind,
      };
      let quotaDepasse = false;
      for (const lecon of leconsAvecExtrait) {
        if (quotaDepasse) break;
        if (lecon.range.to > decoupeur.total) {
          avertissementsExtraits.push(
            `${libelleIntervalle(lecon.range)} : hors du document (${decoupeur.total} au total), extrait non joint.`
          );
          continue;
        }
        try {
          const extrait = await decoupeur.extraire(lecon.range.from, lecon.range.to);
          const resultat = await rattacherExtrait(ctx, {
            lessonId: lecon.id,
            original,
            range: lecon.range,
            octets: extrait,
          });
          if (!resultat.ok) {
            avertissementsExtraits.push(resultat.erreur);
            if (resultat.quota) {
              quotaDepasse = true;
              avertissementsExtraits.push(
                "Quota de stockage atteint : les extraits restants n'ont pas été générés. Libérez de l'espace puis utilisez « Régénérer l'extrait » sur chaque leçon."
              );
            }
          }
        } catch (e) {
          loguer("génération d'un extrait", e);
          avertissementsExtraits.push(`${libelleIntervalle(lecon.range)} : extrait non généré.`);
        }
      }
    }
  }

  if (avertissementsExtraits.length > 0) {
    await supabase
      .from("courses")
      .update({
        description: `${description}\n\nExtraits du document :\n${avertissementsExtraits
          .map((w) => `- ${w}`)
          .join("\n")}`,
      })
      .eq("id", course.id);
  }

  revalidatePath("/catalogue");
  redirect(`/catalogue/${course.id}/modifier`);
}

// ------------------------------------------------------------
// Supports de leçon : retirer (formation en brouillon)
//
// Le téléversement d'un support passe désormais par
// `preparerTeleversement` / `finaliserTeleversement`
// (`src/app/(app)/sources/televersement.ts`) et le composant client
// `TeleverseurFichier` : le fichier va du navigateur au stockage sans
// transiter par le serveur.
// ------------------------------------------------------------

export async function supprimerSupport(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const courseId = String(formData.get("course_id") ?? "");
  const activityId = String(formData.get("activity_id") ?? "");

  const ctx = await verifierEdition(courseId);
  if ("erreur" in ctx) return { error: ctx.erreur };
  const { supabase } = ctx;

  const { data: activite } = await supabase
    .from("activities")
    .select("id, content")
    .eq("id", activityId)
    .maybeSingle();
  if (!activite) return { error: "Support introuvable." };

  const contenu = (activite.content ?? {}) as { file_path?: string; source_id?: string };

  const { error } = await supabase.from("activities").delete().eq("id", activityId);
  if (error) return { error: "La suppression a échoué. Vérifiez vos droits." };

  if (contenu.file_path) {
    await supabase.storage.from("supports").remove([contenu.file_path]);
  }
  if (contenu.source_id) {
    await supabase.from("sources").delete().eq("id", contenu.source_id);
  }

  revalidatePath(`/catalogue/${courseId}/modifier`);
  return { success: "Support retiré (fichier supprimé du stockage)." };
}

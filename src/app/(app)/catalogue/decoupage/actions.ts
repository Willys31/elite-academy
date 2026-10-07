"use server";

import { revalidatePath } from "next/cache";
import { libelleIntervalle, unionIntervalles, type Intervalle } from "@/lib/import/decoupage";
import {
  ouvrirOriginal,
  rattacherExtrait,
  regenererExtrait,
  sourceDeLecon,
  supprimerExtrait,
  type ContexteExtrait,
} from "@/lib/import/rattachement";
import { verifierEdition } from "@/lib/stockage/edition";
import type { ActionState } from "@/app/(app)/catalogue/actions";

/**
 * Retouche du découpage d'une formation importée (lot 21) : renommer
 * et réécrire une leçon, la déplacer, la fusionner avec la suivante,
 * ajuster les pages ou diapositives dont elle reprend la matière.
 *
 * Toutes les actions exigent une formation en brouillon
 * (`verifierEdition`) et vérifient que la leçon appartient bien à la
 * version courante de la formation indiquée : l'identifiant d'une
 * leçon d'une autre formation ne doit pas suffire à la modifier.
 */

const ERREUR_GENERIQUE =
  "L'opération a échoué. Vérifiez vos droits ou réessayez plus tard.";

function loguer(contexte: string, error: unknown) {
  const message =
    error instanceof Error ? error.message : (error as { message?: string })?.message;
  if (message) console.error(`[decoupage] ${contexte} :`, message);
}

type Supabase = Awaited<ReturnType<typeof import("@/lib/supabase/server").createClient>>;

interface LeconChargee {
  id: string;
  title: string;
  content: Record<string, unknown>;
  position: number;
  module_id: string;
  estimated_minutes: number | null;
  module: { id: string; position: number; course_version_id: string };
}

async function chargerLecon(courseId: string, lessonId: string) {
  const ctx = await verifierEdition(courseId);
  if ("erreur" in ctx) return { error: ctx.erreur };
  const { data } = await ctx.supabase
    .from("lessons")
    .select(
      "id, title, content, position, module_id, estimated_minutes, module:modules!inner(id, position, course_version_id)"
    )
    .eq("id", lessonId)
    .maybeSingle();
  if (!data) return { error: "Leçon introuvable." };
  const module = Array.isArray(data.module) ? data.module[0] : data.module;
  if (!module || module.course_version_id !== ctx.course.current_version_id) {
    return { error: "Cette leçon n'appartient pas à la version en cours de la formation." };
  }
  const lecon: LeconChargee = {
    id: data.id,
    title: data.title,
    content: (data.content ?? {}) as Record<string, unknown>,
    position: data.position,
    module_id: data.module_id,
    estimated_minutes: data.estimated_minutes,
    module,
  };
  return { ...ctx, lecon };
}

function contexteExtrait(
  ctx: { supabase: Supabase; user: { id: string }; course: { id: string; organization_id: string } }
): ContexteExtrait {
  return {
    supabase: ctx.supabase,
    userId: ctx.user.id,
    organizationId: ctx.course.organization_id,
    courseId: ctx.course.id,
  };
}

/** Positions 1..n dans l'ordre courant : répare aussi les trous laissés par les suppressions. */
async function renumeroterLecons(supabase: Supabase, moduleId: string) {
  const { data } = await supabase
    .from("lessons")
    .select("id, position")
    .eq("module_id", moduleId)
    .order("position")
    .order("created_at");
  for (const [i, l] of (data ?? []).entries()) {
    if (l.position !== i + 1) {
      await supabase.from("lessons").update({ position: i + 1 }).eq("id", l.id);
    }
  }
}

async function renumeroterModules(supabase: Supabase, versionId: string) {
  const { data } = await supabase
    .from("modules")
    .select("id, position")
    .eq("course_version_id", versionId)
    .order("position")
    .order("created_at");
  for (const [i, m] of (data ?? []).entries()) {
    if (m.position !== i + 1) {
      await supabase.from("modules").update({ position: i + 1 }).eq("id", m.id);
    }
  }
}

function rafraichir(courseId: string, lessonId?: string) {
  revalidatePath(`/catalogue/${courseId}/modifier`);
  if (lessonId) revalidatePath(`/catalogue/${courseId}/lecon/${lessonId}`);
}

// ------------------------------------------------------------
// Leçon : contenu
// ------------------------------------------------------------

export async function mettreAJourLecon(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const courseId = String(formData.get("course_id") ?? "");
  const lessonId = String(formData.get("lesson_id") ?? "");
  const title = String(formData.get("title") ?? "").trim();
  const texte = String(formData.get("texte") ?? "").trim();
  const minutesBrutes = String(formData.get("estimated_minutes") ?? "").trim();
  const minutes = minutesBrutes === "" ? null : parseInt(minutesBrutes, 10);
  if (!title) return { error: "Veuillez saisir le titre de la leçon." };
  if (minutes !== null && (!Number.isFinite(minutes) || minutes < 0)) {
    return { error: "La durée doit être un nombre de minutes positif." };
  }

  const ctx = await chargerLecon(courseId, lessonId);
  if ("error" in ctx) return { error: ctx.error };

  const { error } = await ctx.supabase
    .from("lessons")
    .update({
      title,
      content: { ...ctx.lecon.content, type: "text", text: texte },
      estimated_minutes: minutes,
    })
    .eq("id", lessonId);
  if (error) {
    loguer("mise à jour de la leçon", error);
    return { error: ERREUR_GENERIQUE };
  }
  rafraichir(courseId, lessonId);
  return { success: "Leçon enregistrée." };
}

// ------------------------------------------------------------
// Leçon : position
// ------------------------------------------------------------

export async function deplacerLecon(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const courseId = String(formData.get("course_id") ?? "");
  const lessonId = String(formData.get("lesson_id") ?? "");
  const direction = String(formData.get("direction") ?? "");
  if (direction !== "haut" && direction !== "bas") return { error: ERREUR_GENERIQUE };

  const ctx = await chargerLecon(courseId, lessonId);
  if ("error" in ctx) return { error: ctx.error };
  const { supabase, lecon } = ctx;

  const { data: voisines } = await supabase
    .from("lessons")
    .select("id, position")
    .eq("module_id", lecon.module_id)
    .order("position")
    .order("created_at");
  const liste = voisines ?? [];
  const index = liste.findIndex((l) => l.id === lecon.id);
  const cible = direction === "haut" ? index - 1 : index + 1;
  if (index === -1 || cible < 0 || cible >= liste.length) {
    return { error: "La leçon est déjà en bout de module." };
  }

  // Échange des positions, puis renumérotation : deux positions égales
  // (héritées d'une suppression) ne peuvent pas bloquer le déplacement.
  const positionsOrdonnees = liste.map((_, i) => i + 1);
  const ordre = [...liste];
  [ordre[index], ordre[cible]] = [ordre[cible], ordre[index]];
  for (const [i, l] of ordre.entries()) {
    await supabase.from("lessons").update({ position: positionsOrdonnees[i] }).eq("id", l.id);
  }
  rafraichir(courseId);
  return { success: direction === "haut" ? "Leçon montée." : "Leçon descendue." };
}

export async function changerModuleLecon(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const courseId = String(formData.get("course_id") ?? "");
  const lessonId = String(formData.get("lesson_id") ?? "");
  const moduleId = String(formData.get("module_id") ?? "");
  if (!moduleId) return { error: "Veuillez choisir le module de destination." };

  const ctx = await chargerLecon(courseId, lessonId);
  if ("error" in ctx) return { error: ctx.error };
  const { supabase, lecon } = ctx;
  if (moduleId === lecon.module_id) return { error: "La leçon est déjà dans ce module." };

  const { data: moduleCible } = await supabase
    .from("modules")
    .select("id, title, course_version_id")
    .eq("id", moduleId)
    .maybeSingle();
  if (!moduleCible || moduleCible.course_version_id !== lecon.module.course_version_id) {
    return { error: "Module de destination introuvable dans cette formation." };
  }

  const { count } = await supabase
    .from("lessons")
    .select("id", { count: "exact", head: true })
    .eq("module_id", moduleId);
  const { error } = await supabase
    .from("lessons")
    .update({ module_id: moduleId, position: (count ?? 0) + 1 })
    .eq("id", lessonId);
  if (error) {
    loguer("changement de module", error);
    return { error: ERREUR_GENERIQUE };
  }
  await renumeroterLecons(supabase, lecon.module_id);
  rafraichir(courseId, lessonId);
  return { success: `Leçon déplacée vers « ${moduleCible.title} ».` };
}

/**
 * Fusionne la leçon avec celle qui la suit dans le module : textes
 * concaténés, durées additionnées, activités rattachées, intervalles
 * réunis quand ils sont contigus (l'extrait est alors régénéré).
 */
export async function fusionnerAvecSuivante(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const courseId = String(formData.get("course_id") ?? "");
  const lessonId = String(formData.get("lesson_id") ?? "");

  const ctx = await chargerLecon(courseId, lessonId);
  if ("error" in ctx) return { error: ctx.error };
  const { supabase, lecon } = ctx;

  const { data: voisines } = await supabase
    .from("lessons")
    .select("id, title, content, position, estimated_minutes")
    .eq("module_id", lecon.module_id)
    .order("position")
    .order("created_at");
  const liste = voisines ?? [];
  const index = liste.findIndex((l) => l.id === lecon.id);
  const suivante = index === -1 ? undefined : liste[index + 1];
  if (!suivante) return { error: "Dernière leçon du module : rien à fusionner." };

  const contenuA = lecon.content;
  const contenuB = (suivante.content ?? {}) as Record<string, unknown>;
  const texteA = String(contenuA.text ?? "").trim();
  const texteB = String(contenuB.text ?? "").trim();
  const texte = [texteA, texteB].filter(Boolean).join("\n\n");

  const sourceA = sourceDeLecon(contenuA);
  const sourceB = sourceDeLecon(contenuB);
  let source = sourceA ?? sourceB ?? null;
  let intervalleChange = false;
  let note = "";
  if (sourceA && sourceB) {
    if (sourceA.source_id === sourceB.source_id) {
      const union = unionIntervalles(
        { kind: sourceA.kind, from: sourceA.from, to: sourceA.to },
        { kind: sourceB.kind, from: sourceB.from, to: sourceB.to }
      );
      if (union) {
        source = { ...sourceA, from: union.from, to: union.to };
        intervalleChange = union.from !== sourceA.from || union.to !== sourceA.to;
      } else {
        note = ` Les ${sourceA.kind === "pages" ? "pages" : "diapositives"} des deux leçons ne se suivent pas : l'extrait conservé est celui de la première (${libelleIntervalle(sourceA)}).`;
      }
    } else {
      note = " Les deux leçons viennent de documents différents : l'extrait conservé est celui de la première.";
    }
  } else if (!sourceA && sourceB) {
    intervalleChange = true;
  }

  const minutes =
    lecon.estimated_minutes !== null || suivante.estimated_minutes !== null
      ? (lecon.estimated_minutes ?? 0) + (suivante.estimated_minutes ?? 0)
      : null;

  const { source: _ancienneSource, ...resteA } = contenuA;
  void _ancienneSource;
  const { error: erreurMaj } = await supabase
    .from("lessons")
    .update({
      content: { ...resteA, type: "text", text: texte, ...(source ? { source } : {}) },
      estimated_minutes: minutes,
    })
    .eq("id", lecon.id);
  if (erreurMaj) {
    loguer("fusion", erreurMaj);
    return { error: ERREUR_GENERIQUE };
  }

  // Activités de la suivante : QCM et supports ordinaires rejoignent la
  // leçon ; son extrait disparaît (il sera régénéré sur l'union).
  const ctxExtrait = contexteExtrait(ctx);
  await supprimerExtrait(ctxExtrait, suivante.id);
  const { count } = await supabase
    .from("activities")
    .select("id", { count: "exact", head: true })
    .eq("lesson_id", lecon.id);
  const { data: activitesB } = await supabase
    .from("activities")
    .select("id, position")
    .eq("lesson_id", suivante.id)
    .order("position");
  for (const [i, a] of (activitesB ?? []).entries()) {
    await supabase
      .from("activities")
      .update({ lesson_id: lecon.id, position: (count ?? 0) + i + 1 })
      .eq("id", a.id);
  }

  const { error: erreurSuppression } = await supabase.from("lessons").delete().eq("id", suivante.id);
  if (erreurSuppression) {
    loguer("suppression de la leçon fusionnée", erreurSuppression);
    return { error: "Les contenus sont fusionnés mais la seconde leçon n'a pas pu être retirée." };
  }
  await renumeroterLecons(supabase, lecon.module_id);

  let avertissement = "";
  if (intervalleChange && source) {
    const resultat = await regenererExtrait(ctxExtrait, {
      id: lecon.id,
      content: { ...resteA, source },
    });
    if (!resultat.ok) avertissement = ` ${resultat.erreur}`;
  }

  rafraichir(courseId, lessonId);
  return { success: `Leçons fusionnées : « ${suivante.title} » a rejoint « ${lecon.title} ».${note}${avertissement}` };
}

// ------------------------------------------------------------
// Leçon : extrait du document source
// ------------------------------------------------------------

export async function ajusterExtrait(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const courseId = String(formData.get("course_id") ?? "");
  const lessonId = String(formData.get("lesson_id") ?? "");
  const from = parseInt(String(formData.get("from") ?? ""), 10);
  const to = parseInt(String(formData.get("to") ?? ""), 10);
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to < from) {
    return { error: "Indiquez un intervalle valide : le début doit précéder la fin, à partir de 1." };
  }

  const ctx = await chargerLecon(courseId, lessonId);
  if ("error" in ctx) return { error: ctx.error };
  const { supabase, lecon } = ctx;
  const ctxExtrait = contexteExtrait(ctx);

  // Leçon sans position connue : le document d'import est indiqué par
  // le formulaire (celui des autres leçons de la formation).
  const existante = sourceDeLecon(lecon.content);
  const sourceId = existante?.source_id ?? String(formData.get("source_id") ?? "");
  if (!sourceId) return { error: "Aucun document d'import n'est associé à cette leçon." };

  const ouvert = await ouvrirOriginal(ctxExtrait, sourceId);
  if ("erreur" in ouvert) return { error: ouvert.erreur };
  if (to > ouvert.decoupeur.total) {
    return {
      error: `Le document compte ${ouvert.decoupeur.total} ${
        ouvert.original.kind === "pages" ? "pages" : "diapositives"
      } : l'intervalle ${from}–${to} le dépasse.`,
    };
  }

  const source = {
    source_id: ouvert.original.id,
    kind: ouvert.original.kind,
    from,
    to,
    total: ouvert.decoupeur.total,
  };
  const { error } = await supabase
    .from("lessons")
    .update({ content: { ...lecon.content, source } })
    .eq("id", lecon.id);
  if (error) {
    loguer("ajustement de l'intervalle", error);
    return { error: ERREUR_GENERIQUE };
  }

  await supprimerExtrait(ctxExtrait, lecon.id);
  let octets: Uint8Array;
  try {
    octets = await ouvert.decoupeur.extraire(from, to);
  } catch (e) {
    loguer("découpe", e);
    return { error: "L'intervalle est enregistré mais l'extrait n'a pas pu être généré." };
  }
  const resultat = await rattacherExtrait(ctxExtrait, {
    lessonId: lecon.id,
    original: ouvert.original,
    range: { kind: source.kind, from, to } satisfies Intervalle,
    octets,
  });
  rafraichir(courseId, lessonId);
  if (!resultat.ok) return { error: `L'intervalle est enregistré mais : ${resultat.erreur}` };
  return { success: `Extrait mis à jour : ${libelleIntervalle({ kind: source.kind, from, to })}.` };
}

export async function regenererExtraitLecon(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const courseId = String(formData.get("course_id") ?? "");
  const lessonId = String(formData.get("lesson_id") ?? "");
  const ctx = await chargerLecon(courseId, lessonId);
  if ("error" in ctx) return { error: ctx.error };
  if (!sourceDeLecon(ctx.lecon.content)) {
    return { error: "Cette leçon n'a pas de pages ou diapositives associées." };
  }
  const resultat = await regenererExtrait(contexteExtrait(ctx), ctx.lecon);
  rafraichir(courseId, lessonId);
  if (!resultat.ok) return { error: resultat.erreur };
  return { success: "Extrait régénéré." };
}

export async function retirerExtrait(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const courseId = String(formData.get("course_id") ?? "");
  const lessonId = String(formData.get("lesson_id") ?? "");
  const ctx = await chargerLecon(courseId, lessonId);
  if ("error" in ctx) return { error: ctx.error };
  const { source: _source, ...reste } = ctx.lecon.content;
  void _source;
  await supprimerExtrait(contexteExtrait(ctx), ctx.lecon.id);
  const { error } = await ctx.supabase.from("lessons").update({ content: reste }).eq("id", lessonId);
  if (error) {
    loguer("retrait de l'extrait", error);
    return { error: ERREUR_GENERIQUE };
  }
  rafraichir(courseId, lessonId);
  return { success: "La leçon n'est plus liée au document source." };
}

// ------------------------------------------------------------
// Modules
// ------------------------------------------------------------

async function chargerModule(courseId: string, moduleId: string) {
  const ctx = await verifierEdition(courseId);
  if ("erreur" in ctx) return { error: ctx.erreur };
  const { data: module } = await ctx.supabase
    .from("modules")
    .select("id, title, position, course_version_id")
    .eq("id", moduleId)
    .maybeSingle();
  if (!module || module.course_version_id !== ctx.course.current_version_id) {
    return { error: "Module introuvable dans la version en cours de la formation." };
  }
  return { ...ctx, module };
}

export async function mettreAJourModule(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const courseId = String(formData.get("course_id") ?? "");
  const moduleId = String(formData.get("module_id") ?? "");
  const title = String(formData.get("title") ?? "").trim();
  if (!title) return { error: "Veuillez saisir le titre du module." };

  const ctx = await chargerModule(courseId, moduleId);
  if ("error" in ctx) return { error: ctx.error };
  const { error } = await ctx.supabase
    .from("modules")
    .update({
      title,
      description: String(formData.get("description") ?? "").trim() || null,
    })
    .eq("id", moduleId);
  if (error) {
    loguer("mise à jour du module", error);
    return { error: ERREUR_GENERIQUE };
  }
  rafraichir(courseId);
  return { success: "Module enregistré." };
}

export async function deplacerModule(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const courseId = String(formData.get("course_id") ?? "");
  const moduleId = String(formData.get("module_id") ?? "");
  const direction = String(formData.get("direction") ?? "");
  if (direction !== "haut" && direction !== "bas") return { error: ERREUR_GENERIQUE };

  const ctx = await chargerModule(courseId, moduleId);
  if ("error" in ctx) return { error: ctx.error };
  const { supabase, module } = ctx;

  const { data: modules } = await supabase
    .from("modules")
    .select("id, position")
    .eq("course_version_id", module.course_version_id)
    .order("position")
    .order("created_at");
  const liste = modules ?? [];
  const index = liste.findIndex((m) => m.id === module.id);
  const cible = direction === "haut" ? index - 1 : index + 1;
  if (index === -1 || cible < 0 || cible >= liste.length) {
    return { error: "Le module est déjà en bout de formation." };
  }
  const ordre = [...liste];
  [ordre[index], ordre[cible]] = [ordre[cible], ordre[index]];
  for (const [i, m] of ordre.entries()) {
    await supabase.from("modules").update({ position: i + 1 }).eq("id", m.id);
  }
  await renumeroterModules(supabase, module.course_version_id);
  rafraichir(courseId);
  return { success: direction === "haut" ? "Module monté." : "Module descendu." };
}

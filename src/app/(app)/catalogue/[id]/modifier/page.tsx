import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/profile";
import { isEliteAdmin } from "@/lib/auth/roles";
import {
  availableTransitions,
  canCreateCourse,
  isContentEditable,
  LEVEL_LABELS,
  STATUS_LABELS,
  transitionLabel,
  type CourseStatus,
} from "@/lib/courses/statuts";
import {
  ajouterLecon,
  ajouterModule,
  changerStatut,
  creerQcm,
  lierCompetence,
  mettreAJourFiche,
  retirerCompetence,
  supprimerLecon,
  supprimerModule,
} from "@/app/(app)/catalogue/actions";
import { AuthForm } from "@/components/ui/AuthForm";
import {
  Alert,
  BackLink,
  Badge,
  Card,
  Input,
  Label,
  PageTitle,
  Select,
  Textarea,
} from "@/components/ui";

export const metadata: Metadata = { title: "Éditeur de formation" };

/**
 * Éditeur de formation (UX/UI §5.3) : fiche, modules, leçons,
 * compétences liées et cycle de statuts. Le contenu n'est modifiable
 * qu'en brouillon ; les transitions suivent les rôles.
 */
export default async function EditeurFormationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) redirect("/connexion");

  const supabase = await createClient();
  const { data: formation } = await supabase
    .from("courses")
    .select(
      `id, organization_id, title, description, status, sector, format,
       duration_minutes, context_type, target_audience, prerequisites,
       current_version_id`
    )
    .eq("id", id)
    .maybeSingle();

  if (!formation) notFound();

  const peutModifier =
    isEliteAdmin(user.memberships) ||
    canCreateCourse(user.memberships, formation.organization_id);
  if (!peutModifier) redirect(`/catalogue/${formation.id}`);

  const statut = formation.status as CourseStatus;
  const editable = isContentEditable(statut);
  const transitions = availableTransitions(
    user.memberships,
    formation.organization_id,
    statut
  );

  const [{ data: modules }, { data: liees }, { data: toutesCompetences }] =
    await Promise.all([
      formation.current_version_id
        ? supabase
            .from("modules")
            .select(
              "id, title, description, position, lessons(id, title, position, estimated_minutes, activities(id, title, type))"
            )
            .eq("course_version_id", formation.current_version_id)
            .order("position")
        : Promise.resolve({ data: [] }),
      supabase
        .from("course_competencies")
        .select("competency_id, target_level, competency:competencies(name)")
        .eq("course_id", formation.id),
      supabase.from("competencies").select("id, name, domain").order("name"),
    ]);

  const idsLiees = new Set((liees ?? []).map((l) => l.competency_id));
  const disponibles = (toutesCompetences ?? []).filter((c) => !idsLiees.has(c.id));

  // Provenance IA éventuelle : afficher les alertes de la génération.
  const { data: generation } = await supabase
    .from("ai_generations")
    .select("id, prompt_version, model_name, result, created_at")
    .eq("result_course_id", formation.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const resultatIa = (generation?.result ?? null) as {
    methods_rationale?: string;
    warnings?: string[];
  } | null;

  return (
    <div>
      <BackLink href="/catalogue">Catalogue</BackLink>
      <PageTitle
        action={
          <Link
            href={`/catalogue/${formation.id}`}
            className="inline-flex min-h-11 items-center rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Voir la fiche
          </Link>
        }
      >
        Éditeur — {formation.title}
      </PageTitle>

      <div className="-mt-4 mb-6 flex flex-wrap items-center gap-2">
        <Badge>{STATUS_LABELS[statut]}</Badge>
        {!editable ? (
          <span className="text-sm text-slate-500">
            Contenu verrouillé : repassez en brouillon pour modifier.
          </span>
        ) : null}
      </div>

      {/* Cycle de statuts */}
      <Card className="mb-6">
        <h2 className="mb-2 font-semibold">Cycle de validation</h2>
        {transitions.length === 0 ? (
          <p className="text-sm text-slate-500">
            Aucune action de statut disponible pour votre rôle sur cette
            formation.
          </p>
        ) : (
          <div className="flex flex-wrap gap-3">
            {transitions.map((cible) => (
              <AuthForm
                key={cible}
                action={changerStatut}
                submitLabel={transitionLabel(statut, cible)}
                pendingLabel="Mise à jour…"
              >
                <input type="hidden" name="course_id" value={formation.id} />
                <input type="hidden" name="cible" value={cible} />
              </AuthForm>
            ))}
          </div>
        )}
        {statut === "review" ? (
          <p className="mt-3 text-sm text-slate-500">
            Rappel : la validation doit contrôler l&apos;exactitude, la
            cohérence pédagogique, l&apos;adéquation au public, le lien avec
            les compétences et la qualité du français.
          </p>
        ) : null}
      </Card>

      {generation ? (
        <Card className="mb-6 border-brand-200 bg-brand-50/50">
          <h2 className="mb-2 font-semibold">Contenu généré par IA — à relire</h2>
          <p className="text-xs text-slate-500">
            Générée le {new Date(generation.created_at).toLocaleString("fr-FR")} ·
            modèle {generation.model_name} · prompt {generation.prompt_version}.
            Ce contenu est un brouillon : vérifiez l&apos;exactitude, les exemples
            et la cohérence pédagogique avant de le soumettre à validation.
          </p>
          {resultatIa?.methods_rationale ? (
            <p className="mt-2 text-sm text-slate-700">
              <span className="font-medium">Méthodes choisies : </span>
              {resultatIa.methods_rationale}
            </p>
          ) : null}
          {resultatIa?.warnings && resultatIa.warnings.length > 0 ? (
            <ul className="mt-2 space-y-1 text-sm text-amber-800">
              {resultatIa.warnings.map((w, i) => (
                <li key={i}>⚠ {w}</li>
              ))}
            </ul>
          ) : null}
        </Card>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
        {/* Colonne principale : fiche + modules */}
        <div className="space-y-6">
          <Card>
            <h2 className="mb-3 font-semibold">Fiche de la formation</h2>
            {!editable ? (
              <Alert kind="info">
                Fiche en lecture seule ({STATUS_LABELS[statut]}).
              </Alert>
            ) : (
              <AuthForm
                action={mettreAJourFiche}
                submitLabel="Enregistrer la fiche"
                pendingLabel="Enregistrement…"
              >
                <input type="hidden" name="course_id" value={formation.id} />
                <div>
                  <Label htmlFor="title">Titre</Label>
                  <Input id="title" name="title" required defaultValue={formation.title} />
                </div>
                <div>
                  <Label htmlFor="description">Description</Label>
                  <Textarea
                    id="description"
                    name="description"
                    rows={3}
                    defaultValue={formation.description ?? ""}
                  />
                </div>
                <div>
                  <Label htmlFor="target_audience">Public cible</Label>
                  <Textarea
                    id="target_audience"
                    name="target_audience"
                    rows={2}
                    defaultValue={formation.target_audience ?? ""}
                  />
                </div>
                <div>
                  <Label htmlFor="prerequisites">Prérequis</Label>
                  <Textarea
                    id="prerequisites"
                    name="prerequisites"
                    rows={2}
                    defaultValue={formation.prerequisites ?? ""}
                  />
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <Label htmlFor="context_type">Contexte</Label>
                    <Select
                      id="context_type"
                      name="context_type"
                      defaultValue={formation.context_type}
                    >
                      <option value="generic">Générique</option>
                      <option value="sector">Sectoriel</option>
                      <option value="organization">Entreprise</option>
                      <option value="brand">Marque</option>
                      <option value="confidential">Confidentiel</option>
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor="sector">Secteur</Label>
                    <Input id="sector" name="sector" defaultValue={formation.sector ?? ""} />
                  </div>
                  <div>
                    <Label htmlFor="format">Format</Label>
                    <Select id="format" name="format" defaultValue={formation.format}>
                      <option value="online">En ligne</option>
                      <option value="in_person">Présentiel</option>
                      <option value="hybrid">Hybride</option>
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor="duration_minutes">Durée (minutes)</Label>
                    <Input
                      id="duration_minutes"
                      name="duration_minutes"
                      type="number"
                      min={0}
                      defaultValue={formation.duration_minutes ?? ""}
                    />
                  </div>
                </div>
              </AuthForm>
            )}
          </Card>

          <section aria-label="Modules et leçons">
            <h2 className="mb-3 text-lg font-semibold">Modules et leçons</h2>
            <div className="space-y-4">
              {(modules ?? []).map((m, i) => (
                <Card key={m.id}>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h3 className="font-medium">
                        Module {i + 1} — {m.title}
                      </h3>
                      {m.description ? (
                        <p className="mt-1 text-sm text-slate-600">{m.description}</p>
                      ) : null}
                    </div>
                    {editable ? (
                      <AuthForm
                        action={supprimerModule}
                        submitLabel="Supprimer"
                        pendingLabel="Suppression…"
                      >
                        <input type="hidden" name="course_id" value={formation.id} />
                        <input type="hidden" name="module_id" value={m.id} />
                      </AuthForm>
                    ) : null}
                  </div>

                  {m.lessons && m.lessons.length > 0 ? (
                    <ul className="mt-3 space-y-2">
                      {[...m.lessons]
                        .sort((a, b) => a.position - b.position)
                        .map((l) => (
                          <li key={l.id} className="rounded-lg bg-slate-50 px-3 py-2 text-sm">
                            <div className="flex items-center justify-between gap-2">
                              <span>
                                {l.title}
                                {l.estimated_minutes ? (
                                  <span className="ml-2 text-xs text-slate-400">
                                    {l.estimated_minutes} min
                                  </span>
                                ) : null}
                              </span>
                              {editable ? (
                                <AuthForm
                                  action={supprimerLecon}
                                  submitLabel="Retirer"
                                  pendingLabel="…"
                                >
                                  <input type="hidden" name="course_id" value={formation.id} />
                                  <input type="hidden" name="lesson_id" value={l.id} />
                                </AuthForm>
                              ) : null}
                            </div>

                            {/* QCM de la leçon */}
                            {(l.activities ?? []).length > 0 ? (
                              <div className="mt-2 flex flex-wrap gap-2">
                                {(l.activities ?? []).map((a) => (
                                  <Link
                                    key={a.id}
                                    href={`/catalogue/${formation.id}/qcm/${a.id}`}
                                    className="rounded-full bg-brand-50 px-2.5 py-0.5 text-xs font-medium text-brand-700 hover:bg-brand-100"
                                  >
                                    📝 {a.title}
                                  </Link>
                                ))}
                              </div>
                            ) : null}

                            {editable ? (
                              <details className="mt-2">
                                <summary className="cursor-pointer text-xs font-medium text-brand-600">
                                  Ajouter un QCM à cette leçon
                                </summary>
                                <div className="mt-2">
                                  <AuthForm
                                    action={creerQcm}
                                    submitLabel="Créer le QCM"
                                    pendingLabel="Création…"
                                  >
                                    <input type="hidden" name="course_id" value={formation.id} />
                                    <input type="hidden" name="lesson_id" value={l.id} />
                                    <div>
                                      <Label htmlFor={`titre-qcm-${l.id}`}>Titre du QCM</Label>
                                      <Input id={`titre-qcm-${l.id}`} name="title" required />
                                    </div>
                                  </AuthForm>
                                </div>
                              </details>
                            ) : null}
                          </li>
                        ))}
                    </ul>
                  ) : (
                    <p className="mt-2 text-sm text-slate-400">Aucune leçon.</p>
                  )}

                  {editable ? (
                    <details className="mt-3">
                      <summary className="cursor-pointer text-sm font-medium text-brand-600">
                        Ajouter une leçon
                      </summary>
                      <div className="mt-3">
                        <AuthForm
                          action={ajouterLecon}
                          submitLabel="Ajouter la leçon"
                          pendingLabel="Ajout…"
                        >
                          <input type="hidden" name="course_id" value={formation.id} />
                          <input type="hidden" name="module_id" value={m.id} />
                          <div>
                            <Label htmlFor={`titre-lecon-${m.id}`}>Titre</Label>
                            <Input id={`titre-lecon-${m.id}`} name="title" required />
                          </div>
                          <div>
                            <Label htmlFor={`texte-lecon-${m.id}`}>Contenu (texte)</Label>
                            <Textarea id={`texte-lecon-${m.id}`} name="texte" rows={4} />
                          </div>
                          <div>
                            <Label htmlFor={`minutes-lecon-${m.id}`}>Durée estimée (minutes)</Label>
                            <Input
                              id={`minutes-lecon-${m.id}`}
                              name="estimated_minutes"
                              type="number"
                              min={0}
                            />
                          </div>
                        </AuthForm>
                      </div>
                    </details>
                  ) : null}
                </Card>
              ))}

              {editable ? (
                <Card>
                  <h3 className="mb-3 font-medium">Nouveau module</h3>
                  <AuthForm
                    action={ajouterModule}
                    submitLabel="Ajouter le module"
                    pendingLabel="Ajout…"
                  >
                    <input type="hidden" name="course_id" value={formation.id} />
                    <div>
                      <Label htmlFor="titre-module">Titre du module</Label>
                      <Input id="titre-module" name="title" required />
                    </div>
                    <div>
                      <Label htmlFor="description-module">Description (facultatif)</Label>
                      <Textarea id="description-module" name="description" rows={2} />
                    </div>
                  </AuthForm>
                </Card>
              ) : null}
            </div>
          </section>
        </div>

        {/* Colonne latérale : compétences */}
        <div className="space-y-6">
          <Card>
            <h2 className="mb-3 font-semibold">Compétences visées</h2>
            {(liees ?? []).length === 0 ? (
              <p className="text-sm text-slate-500">
                Aucune compétence liée. Une formation doit viser au moins une
                compétence observable avant validation.
              </p>
            ) : (
              <ul className="space-y-2">
                {(liees ?? []).map((l) => {
                  const comp = Array.isArray(l.competency)
                    ? l.competency[0]
                    : l.competency;
                  return (
                    <li
                      key={l.competency_id}
                      className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm"
                    >
                      <span>
                        {comp?.name}{" "}
                        <Badge>{LEVEL_LABELS[l.target_level] ?? l.target_level}</Badge>
                      </span>
                      {editable ? (
                        <AuthForm
                          action={retirerCompetence}
                          submitLabel="Retirer"
                          pendingLabel="…"
                        >
                          <input type="hidden" name="course_id" value={formation.id} />
                          <input
                            type="hidden"
                            name="competency_id"
                            value={l.competency_id}
                          />
                        </AuthForm>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}

            {editable && disponibles.length > 0 ? (
              <div className="mt-4 border-t border-slate-100 pt-4">
                <AuthForm
                  action={lierCompetence}
                  submitLabel="Lier la compétence"
                  pendingLabel="Ajout…"
                >
                  <input type="hidden" name="course_id" value={formation.id} />
                  <div>
                    <Label htmlFor="competency_id">Compétence</Label>
                    <Select id="competency_id" name="competency_id" required>
                      {disponibles.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                          {c.domain ? ` (${c.domain})` : ""}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor="target_level">Niveau visé</Label>
                    <Select id="target_level" name="target_level" defaultValue="fundamentals">
                      <option value="fundamentals">Fondamentaux</option>
                      <option value="operational">Opérationnel</option>
                      <option value="advanced">Avancé</option>
                      <option value="elite">Elite</option>
                    </Select>
                  </div>
                </AuthForm>
                <p className="mt-2 text-xs text-slate-400">
                  Compétence manquante ?{" "}
                  <Link href="/competences" className="text-brand-600 hover:underline">
                    Gérer le référentiel
                  </Link>
                </p>
              </div>
            ) : null}
          </Card>
        </div>
      </div>
    </div>
  );
}

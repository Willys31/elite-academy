import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/profile";
import { isEliteAdmin } from "@/lib/auth/roles";
import {
  canCreateCourse,
  isContentEditable,
  STATUS_LABELS,
  type CourseStatus,
} from "@/lib/courses/statuts";
import {
  estActiviteRedigee,
  lireContenuActiviteRedigee,
  TYPE_ACTIVITE_REDIGEE_AIDES,
  TYPE_ACTIVITE_REDIGEE_LABELS,
  TYPES_ACTIVITE_REDIGEE,
} from "@/lib/courses/activites-redigees";
import { mettreAJourActiviteRedigee, supprimerActivite } from "@/app/(app)/catalogue/actions";
import { AuthForm } from "@/components/ui/AuthForm";
import { Alert, Badge, Card, Input, Label, PageTitle, Select, Textarea } from "@/components/ui";

export const metadata: Metadata = { title: "Activité rédigée" };

/**
 * Éditeur d'une activité rédigée (lot 26) : exercice, étude de cas ou
 * simulation à laquelle l'apprenant répond par écrit. Les champs sont
 * ceux que l'IA et le formateur utilisent pour corriger : consigne,
 * résultat attendu, critères d'évaluation, difficulté, compétence.
 * Modifiable uniquement quand la formation est en brouillon.
 */
export default async function ActiviteRedigeePage({
  params,
}: {
  params: Promise<{ id: string; activiteId: string }>;
}) {
  const { id, activiteId } = await params;
  const user = await getCurrentUser();
  if (!user) redirect("/connexion");

  const supabase = await createClient();
  const { data: formation } = await supabase
    .from("courses")
    .select("id, title, status, organization_id")
    .eq("id", id)
    .maybeSingle();
  if (!formation) notFound();

  const peutModifier =
    isEliteAdmin(user.memberships) ||
    canCreateCourse(user.memberships, formation.organization_id);
  if (!peutModifier) redirect(`/catalogue/${formation.id}`);

  const { data: activite } = await supabase
    .from("activities")
    .select(
      "id, type, title, instructions, difficulty, content, generated_by_ai, lesson:lessons(title), activity_competencies(competency_id, competency:competencies(name))"
    )
    .eq("id", activiteId)
    .maybeSingle();
  if (!activite || !estActiviteRedigee(activite.type)) notFound();

  const { data: liees } = await supabase
    .from("course_competencies")
    .select("competency_id, competency:competencies(name)")
    .eq("course_id", formation.id);

  const statut = formation.status as CourseStatus;
  const editable = isContentEditable(statut);
  const contenu = lireContenuActiviteRedigee(activite.content);
  const lecon = Array.isArray(activite.lesson) ? activite.lesson[0] : activite.lesson;
  const competenceActuelle = (activite.activity_competencies ?? [])[0]?.competency_id ?? "";
  const nomsCompetences = (activite.activity_competencies ?? [])
    .map((ac) => {
      const c = Array.isArray(ac.competency) ? ac.competency[0] : ac.competency;
      return c?.name;
    })
    .filter(Boolean) as string[];

  return (
    <div className="mx-auto max-w-3xl">
      <p className="mb-2 text-sm">
        <Link href={`/catalogue/${formation.id}/modifier`} className="text-brand-600 hover:underline">
          ← Éditeur de {formation.title}
        </Link>
      </p>
      <PageTitle action={<Badge>{STATUS_LABELS[statut]}</Badge>}>
        {TYPE_ACTIVITE_REDIGEE_LABELS[activite.type]} — {activite.title}
      </PageTitle>
      <p className="-mt-4 mb-6 text-sm text-slate-500">
        Leçon : {lecon?.title ?? "—"}
        {activite.generated_by_ai ? " · générée par l'IA, à relire" : ""}
      </p>

      {!editable ? (
        <div className="mb-6">
          <Alert kind="info">
            Activité en lecture seule ({STATUS_LABELS[statut]}) : repassez la formation en brouillon pour la modifier.
          </Alert>
        </div>
      ) : null}

      <Card>
        <h2 className="mb-3 font-semibold">Aperçu pour l&apos;apprenant</h2>
        <div className="space-y-3 text-sm text-slate-800">
          <p className="whitespace-pre-line">{activite.instructions}</p>
          {contenu.expected_outcome ? (
            <p>
              <span className="font-medium">Résultat attendu : </span>
              {contenu.expected_outcome}
            </p>
          ) : null}
          {contenu.evaluation ? (
            <p>
              <span className="font-medium">Critères d&apos;évaluation : </span>
              {contenu.evaluation}
            </p>
          ) : null}
          <p className="text-xs text-slate-500">
            {contenu.correction_humaine ? "Correction humaine obligatoire · " : "Correction automatique · "}
            Difficulté {activite.difficulty}/5
            {nomsCompetences.length > 0 ? ` · Compétence : ${nomsCompetences.join(", ")}` : " · Aucune compétence liée"}
          </p>
          {contenu.media_brief ? (
            <p className="text-xs text-slate-500">
              Média à réaliser ({contenu.media_brief.kind}) : {contenu.media_brief.description}
            </p>
          ) : null}
        </div>
      </Card>

      {editable ? (
        <Card className="mt-6">
          <h2 className="mb-3 font-semibold">Modifier l&apos;activité</h2>
          <AuthForm action={mettreAJourActiviteRedigee} submitLabel="Enregistrer" pendingLabel="Enregistrement…">
            <input type="hidden" name="course_id" value={formation.id} />
            <input type="hidden" name="activity_id" value={activite.id} />
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="type">Type</Label>
                <Select id="type" name="type" defaultValue={activite.type}>
                  {TYPES_ACTIVITE_REDIGEE.map((t) => (
                    <option key={t} value={t}>
                      {TYPE_ACTIVITE_REDIGEE_LABELS[t]}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor="difficulty">Difficulté</Label>
                <Select id="difficulty" name="difficulty" defaultValue={String(activite.difficulty)}>
                  {[1, 2, 3, 4, 5].map((d) => (
                    <option key={d} value={d}>
                      {d}/5
                    </option>
                  ))}
                </Select>
              </div>
            </div>
            <div>
              <Label htmlFor="title">Titre</Label>
              <Input id="title" name="title" defaultValue={activite.title} required />
            </div>
            <div>
              <Label htmlFor="instructions">Consigne</Label>
              <Textarea id="instructions" name="instructions" rows={8} defaultValue={activite.instructions ?? ""} required />
              <p className="mt-1 text-xs text-slate-500">{TYPE_ACTIVITE_REDIGEE_AIDES[activite.type]}</p>
            </div>
            <div>
              <Label htmlFor="expected_outcome">Résultat attendu</Label>
              <Textarea id="expected_outcome" name="expected_outcome" rows={3} defaultValue={contenu.expected_outcome} />
            </div>
            <div>
              <Label htmlFor="evaluation">Critères d&apos;évaluation (obligatoire)</Label>
              <Textarea id="evaluation" name="evaluation" rows={4} defaultValue={contenu.evaluation} required />
              <p className="mt-1 text-xs text-slate-500">
                Visibles de l&apos;apprenant avant sa réponse. L&apos;IA pré-corrige et le formateur valide sur cette base.
              </p>
            </div>
            <label className="flex items-start gap-2 text-sm text-slate-700">
              <input type="checkbox" name="correction_humaine" defaultChecked={contenu.correction_humaine} className="mt-0.5 size-4 accent-brand-700" />
              <span>
                <span className="font-medium text-ink-900">Correction humaine obligatoire</span>
                {" "}— un formateur notera chaque réponse (contenu certifiant, réglementaire ou sensible). Sinon, la
                correction est automatique et un formateur peut relire sur demande.
              </span>
            </label>
            <div>
              <Label htmlFor="competency_id">Compétence évaluée</Label>
              <Select id="competency_id" name="competency_id" defaultValue={competenceActuelle}>
                <option value="">— Aucune —</option>
                {(liees ?? []).map((c) => {
                  const comp = Array.isArray(c.competency) ? c.competency[0] : c.competency;
                  return (
                    <option key={c.competency_id} value={c.competency_id}>
                      {comp?.name ?? c.competency_id}
                    </option>
                  );
                })}
              </Select>
            </div>
          </AuthForm>

          <div className="mt-6 border-t border-slate-100 pt-4">
            <AuthForm action={supprimerActivite} submitLabel="Supprimer l'activité" pendingLabel="Suppression…">
              <input type="hidden" name="course_id" value={formation.id} />
              <input type="hidden" name="activity_id" value={activite.id} />
            </AuthForm>
          </div>
        </Card>
      ) : null}
    </div>
  );
}

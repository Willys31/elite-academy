import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/profile";
import { canEditCourse, isContentEditable, type CourseStatus } from "@/lib/courses/statuts";
import { libelleIntervalle } from "@/lib/import/decoupage";
import { sourceDeLecon, uniteDe } from "@/lib/import/rattachement";
import { formaterTaille } from "@/lib/stockage/limites";
import {
  ajusterExtrait,
  mettreAJourLecon,
  regenererExtraitLecon,
  retirerExtrait,
} from "@/app/(app)/catalogue/decoupage/actions";
import { supprimerSupport } from "@/app/(app)/catalogue/importer/actions";
import { AuthForm } from "@/components/ui/AuthForm";
import { DangerForm } from "@/components/ui/DangerForm";
import { Alert, Badge, Card, Input, Label, PageTitle, Retour, Textarea } from "@/components/ui";

export const metadata: Metadata = { title: "Leçon — éditeur" };

/**
 * Durée maximale (Vercel Pro) : ajuster l'intervalle ou régénérer un
 * extrait relit le document d'origine (jusqu'à 100 Mo) depuis Storage.
 */
export const maxDuration = 300;

/**
 * Éditeur d'une leçon (lot 21) : titre, texte, durée, et l'extrait du
 * document source dont elle reprend la matière (pages ou
 * diapositives), ajustable ; supports et QCM rattachés.
 */
export default async function EditeurLeconPage({
  params,
}: {
  params: Promise<{ id: string; leconId: string }>;
}) {
  const { id, leconId } = await params;
  const user = await getCurrentUser();
  if (!user) redirect("/connexion");

  const supabase = await createClient();
  const { data: formation } = await supabase
    .from("courses")
    .select("id, organization_id, title, status, current_version_id, owner_id")
    .eq("id", id)
    .maybeSingle();
  if (!formation) notFound();

  const peutModifier = canEditCourse(
    user.memberships,
    formation.organization_id,
    formation.owner_id,
    user.id
  );
  if (!peutModifier) redirect(`/catalogue/${formation.id}`);
  const editable = isContentEditable(formation.status as CourseStatus);

  const { data: lecon } = await supabase
    .from("lessons")
    .select(
      "id, title, content, position, estimated_minutes, module:modules!inner(id, title, course_version_id), activities(id, title, type, content, position)"
    )
    .eq("id", leconId)
    .maybeSingle();
  if (!lecon) notFound();
  const module = Array.isArray(lecon.module) ? lecon.module[0] : lecon.module;
  if (!module || module.course_version_id !== formation.current_version_id) notFound();

  const contenu = (lecon.content ?? {}) as { text?: string };
  const source = sourceDeLecon(lecon.content);

  // Document d'import de la leçon — ou, pour une leçon sans position
  // connue, celui des autres leçons de la formation, afin de pouvoir
  // lui indiquer ses pages à la main.
  let original: { id: string; title: string; mime_type: string; size_bytes: number | null } | null = null;
  let sourceProposee: string | null = null;
  if (source) {
    const { data } = await supabase
      .from("sources")
      .select("id, title, mime_type, size_bytes")
      .eq("id", source.source_id)
      .maybeSingle();
    original = data ?? null;
  } else if (formation.current_version_id) {
    const { data: voisines } = await supabase
      .from("lessons")
      .select("content, module:modules!inner(course_version_id)")
      .eq("module.course_version_id", formation.current_version_id)
      .not("content->source", "is", null)
      .limit(1);
    const voisine = voisines?.[0] ? sourceDeLecon(voisines[0].content) : null;
    if (voisine) {
      const { data } = await supabase
        .from("sources")
        .select("id, title, mime_type, size_bytes")
        .eq("id", voisine.source_id)
        .maybeSingle();
      if (data && uniteDe(data.mime_type)) {
        original = data;
        sourceProposee = data.id;
      }
    }
  }

  const activites = [...(lecon.activities ?? [])].sort((a, b) => a.position - b.position);
  const extraits = activites.filter(
    (a) => a.type === "file" && Boolean((a.content as { range?: unknown } | null)?.range)
  );
  const supports = activites.filter(
    (a) => a.type === "file" && !(a.content as { range?: unknown } | null)?.range
  );
  const quizzes = activites.filter((a) => a.type === "quiz");

  const idsSources = activites
    .filter((a) => a.type === "file")
    .map((a) => (a.content as { source_id?: string } | null)?.source_id)
    .filter((s): s is string => Boolean(s));
  const { data: lignesSources } = idsSources.length
    ? await supabase.from("sources").select("id, size_bytes").in("id", idsSources)
    : { data: [] as Array<{ id: string; size_bytes: number | null }> };
  const tailleParSource = new Map((lignesSources ?? []).map((s) => [s.id, Number(s.size_bytes ?? 0)]));

  const unite = original ? uniteDe(original.mime_type) : source?.kind ?? null;
  const nomUnite = unite === "slides" ? "diapositives" : "pages";

  return (
    <div className="mx-auto max-w-3xl">
      <Retour href={`/catalogue/${formation.id}/modifier`} ton="sobre" />
      <PageTitle action={source ? <Badge ton="or">{libelleIntervalle(source)}</Badge> : undefined}>
        {lecon.title}
      </PageTitle>
      <p className="-mt-4 mb-6 text-sm text-slate-500">
        {formation.title} · {module.title}
      </p>

      {!editable ? (
        <div className="mb-6">
          <Alert kind="info">
            Contenu verrouillé : repassez la formation en brouillon pour modifier cette leçon.
          </Alert>
        </div>
      ) : null}

      <Card className="mb-6">
        <h2 className="mb-3 font-semibold">Contenu de la leçon</h2>
        {editable ? (
          <AuthForm action={mettreAJourLecon} submitLabel="Enregistrer la leçon" pendingLabel="Enregistrement…">
            <input type="hidden" name="course_id" value={formation.id} />
            <input type="hidden" name="lesson_id" value={lecon.id} />
            <div>
              <Label htmlFor="title">Titre</Label>
              <Input id="title" name="title" required defaultValue={lecon.title} />
            </div>
            <div>
              <Label htmlFor="texte">Texte</Label>
              <Textarea id="texte" name="texte" rows={14} defaultValue={contenu.text ?? ""} />
              <p className="mt-1 text-xs text-slate-500">
                Texte issu du document importé, relu et corrigé par vos soins. Les sauts de ligne sont conservés.
              </p>
            </div>
            <div className="max-w-xs">
              <Label htmlFor="estimated_minutes">Durée estimée (minutes)</Label>
              <Input
                id="estimated_minutes"
                name="estimated_minutes"
                type="number"
                min={0}
                defaultValue={lecon.estimated_minutes ?? ""}
              />
            </div>
          </AuthForm>
        ) : (
          <div className="whitespace-pre-line text-[15px] leading-relaxed text-slate-800">
            {contenu.text || "Cette leçon n'a pas encore de contenu rédigé."}
          </div>
        )}
      </Card>

      {original && unite ? (
        <Card className="mb-6">
          <h2 className="mb-1 font-semibold">Extrait du document source</h2>
          <p className="mb-3 text-sm text-slate-500">
            Document : <span className="font-medium text-ink-900">{original.title}</span>
            {original.size_bytes ? ` (${formaterTaille(Number(original.size_bytes))})` : ""}
            {source ? ` · ${source.total} ${nomUnite} au total` : ""}
          </p>

          {source ? (
            <p className="mb-3 text-sm">
              Cette leçon reprend les{" "}
              <span className="font-medium">{libelleIntervalle(source).toLowerCase()}</span>.
              {extraits.length === 0 ? (
                <span className="text-amber-800">
                  {" "}
                  L&apos;extrait correspondant n&apos;est pas joint (quota ou erreur à l&apos;import) :
                  régénérez-le ci-dessous.
                </span>
              ) : null}
            </p>
          ) : (
            <Alert kind="info">
              Les {nomUnite} de cette leçon n&apos;ont pas été identifiées à l&apos;import.
              Indiquez-les ci-dessous : l&apos;extrait correspondant sera joint à la leçon.
            </Alert>
          )}

          {extraits.map((a) => {
            const c = a.content as { source_id?: string };
            const taille = c.source_id ? tailleParSource.get(c.source_id) : undefined;
            return (
              <p key={a.id} className="mt-2 text-sm text-slate-700">
                📎 {a.title}
                {taille ? <span className="ml-2 text-slate-400">{formaterTaille(taille)}</span> : null}
              </p>
            );
          })}

          {editable ? (
            <div className="mt-4 space-y-4 border-t border-slate-100 pt-4">
              <AuthForm
                action={ajusterExtrait}
                submitLabel={source ? "Mettre à jour l'extrait" : "Joindre l'extrait"}
                pendingLabel="Génération de l'extrait…"
                ton="sobre"
              >
                <input type="hidden" name="course_id" value={formation.id} />
                <input type="hidden" name="lesson_id" value={lecon.id} />
                {sourceProposee ? <input type="hidden" name="source_id" value={sourceProposee} /> : null}
                <div className="grid max-w-sm grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="from">{unite === "slides" ? "Première diapositive" : "Première page"}</Label>
                    <Input id="from" name="from" type="number" min={1} required defaultValue={source?.from ?? ""} />
                  </div>
                  <div>
                    <Label htmlFor="to">{unite === "slides" ? "Dernière diapositive" : "Dernière page"}</Label>
                    <Input id="to" name="to" type="number" min={1} required defaultValue={source?.to ?? ""} />
                  </div>
                </div>
                <p className="text-xs text-slate-500">
                  L&apos;extrait est régénéré depuis le document original ; l&apos;ancien est supprimé du
                  stockage. Deux leçons voisines peuvent partager une {unite === "slides" ? "diapositive" : "page"}{" "}
                  frontière.
                </p>
              </AuthForm>

              {source ? (
                <div className="flex flex-wrap gap-3">
                  {extraits.length === 0 ? (
                    <AuthForm
                      action={regenererExtraitLecon}
                      submitLabel="Régénérer l'extrait"
                      pendingLabel="Génération…"
                      ton="sobre"
                    >
                      <input type="hidden" name="course_id" value={formation.id} />
                      <input type="hidden" name="lesson_id" value={lecon.id} />
                    </AuthForm>
                  ) : null}
                  <DangerForm
                    action={retirerExtrait}
                    label="Retirer l'extrait"
                    confirmLabel="Confirmer le retrait"
                    pendingLabel="Retrait…"
                    question="La leçon ne sera plus liée au document source et son extrait sera supprimé."
                  >
                    <input type="hidden" name="course_id" value={formation.id} />
                    <input type="hidden" name="lesson_id" value={lecon.id} />
                  </DangerForm>
                </div>
              ) : null}
            </div>
          ) : null}
        </Card>
      ) : null}

      <Card className="mb-6">
        <h2 className="mb-3 font-semibold">Supports et activités</h2>
        {supports.length === 0 && quizzes.length === 0 ? (
          <p className="text-sm text-slate-500">
            Aucun support ni QCM. Ajoutez-les depuis{" "}
            <Link href={`/catalogue/${formation.id}/modifier`} className="text-brand-700 underline">
              l&apos;éditeur de la formation
            </Link>
            .
          </p>
        ) : (
          <ul className="space-y-2 text-sm">
            {quizzes.map((a) => (
              <li key={a.id}>
                <Link href={`/catalogue/${formation.id}/qcm/${a.id}`} className="text-brand-700 hover:underline">
                  📝 {a.title}
                </Link>
              </li>
            ))}
            {supports.map((a) => {
              const c = a.content as { source_id?: string };
              const taille = c.source_id ? tailleParSource.get(c.source_id) : undefined;
              return (
                <li key={a.id} className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between">
                  <span>
                    📎 {a.title}
                    {taille ? <span className="ml-2 text-slate-400">{formaterTaille(taille)}</span> : null}
                  </span>
                  {editable ? (
                    <AuthForm action={supprimerSupport} submitLabel="Retirer" pendingLabel="…" compact>
                      <input type="hidden" name="course_id" value={formation.id} />
                      <input type="hidden" name="activity_id" value={a.id} />
                    </AuthForm>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}

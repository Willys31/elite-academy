import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/profile";
import { STATUTS_AVEC_ACCES } from "@/lib/courses/inscriptions";
import { lirePreferences } from "@/lib/profil/preferences";
import { PORTEE_DESCRIPTIONS, PORTEE_LABELS, PORTEES, recommandationPortee } from "@/lib/partage/visibilite";
import { entraideActive, LIMITE_BLOCAGE, MIN_BLOCAGE } from "@/lib/entraide/entraide";
import { partagerBlocage } from "@/app/(app)/entraide/actions";
import { AuthForm } from "@/components/ui/AuthForm";
import { Alert, CLASSES_CHAMP, Textarea } from "@/components/ui";
import { Champ, EcranTitre, LienSobre, Panneau, Retour } from "@/components/app";

export const metadata: Metadata = { title: "Partager un blocage" };

/**
 * Publication d'un point bloquant (addendum Entraide §3.1). Pré-rempli
 * depuis la page d'activité (`?formation=&activite=`). Les compétences
 * proposées sont celles des formations suivies.
 */
export default async function NouveauBlocagePage({
  searchParams,
}: {
  searchParams: Promise<{ formation?: string; activite?: string; competence?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/connexion");
  const params = await searchParams;

  const supabase = await createClient();
  const [{ data: profil }, { data: inscriptions }] = await Promise.all([
    supabase.from("profiles").select("preferences").eq("id", user.id).maybeSingle(),
    supabase
      .from("enrollments")
      .select("course:courses(id, title, course_competencies(competency:competencies(id, name)))")
      .eq("user_id", user.id)
      .in("status", [...STATUTS_AVEC_ACCES]),
  ]);

  if (!entraideActive(lirePreferences(profil?.preferences))) {
    return (
      <div className="mx-auto max-w-2xl">
        <Retour href="/entraide" />
        <Alert kind="info">
          L&apos;Entraide est désactivée sur votre compte. Activez-la depuis votre
          profil pour partager un blocage.
        </Alert>
        <div className="mt-4">
          <LienSobre href="/profil">Aller à mon profil</LienSobre>
        </div>
      </div>
    );
  }

  const premier = <T,>(v: T | T[] | null | undefined): T | null =>
    Array.isArray(v) ? (v[0] ?? null) : (v ?? null);

  const formations = (inscriptions ?? [])
    .map((i) => premier(i.course))
    .filter((c): c is NonNullable<typeof c> => Boolean(c))
    .map((c) => ({
      id: c.id as string,
      title: c.title as string,
      competences: ((c.course_competencies ?? []) as Array<{ competency: unknown }>)
        .map((cc) => premier(cc.competency) as { id: string; name: string } | null)
        .filter((k): k is { id: string; name: string } => Boolean(k)),
    }));

  const formationChoisie = formations.find((f) => f.id === params.formation) ?? null;

  // Activité pré-remplie : on affiche son titre pour situer le blocage.
  const { data: activite } = params.activite
    ? await supabase.from("activities").select("id, title").eq("id", params.activite).maybeSingle()
    : { data: null };

  return (
    <div className="mx-auto max-w-2xl">
      <Retour href="/entraide" />
      <EcranTitre
        eyebrow="Entraide"
        intro="Décrivez ce qui bloque en une ou deux phrases : le concept, et pourquoi il résiste. Votre nom n'apparaîtra pas."
      >
        Partager mon blocage
      </EcranTitre>

      {formations.length === 0 ? (
        <Alert kind="info">Vous n&apos;êtes inscrit à aucune formation : un blocage se rattache toujours à une formation.</Alert>
      ) : (
        <Panneau>
          <AuthForm action={partagerBlocage} submitLabel="Publier mon blocage" pendingLabel="Publication…">
            {activite ? <input type="hidden" name="activity_id" value={activite.id} /> : null}

            <div>
              <Champ htmlFor="course_id">Formation</Champ>
              <select id="course_id" name="course_id" required className={CLASSES_CHAMP} defaultValue={formationChoisie?.id ?? ""}>
                <option value="" disabled>Choisir…</option>
                {formations.map((f) => (
                  <option key={f.id} value={f.id}>{f.title}</option>
                ))}
              </select>
              {activite ? (
                <p className="mt-1.5 text-xs text-slate-500">Depuis l&apos;activité « {activite.title} ».</p>
              ) : null}
            </div>

            <div>
              <Champ htmlFor="competency_id" hint="facultatif">Compétence concernée</Champ>
              <select id="competency_id" name="competency_id" className={CLASSES_CHAMP} defaultValue={params.competence ?? ""}>
                <option value="">Je ne sais pas / plusieurs</option>
                {(formationChoisie ? [formationChoisie] : formations).map((f) => (
                  <optgroup key={f.id} label={f.title}>
                    {f.competences.map((k) => (
                      <option key={k.id} value={k.id}>{k.name}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>

            <div>
              <Champ htmlFor="description" hint={`${MIN_BLOCAGE} à ${LIMITE_BLOCAGE} caractères`}>
                Mon blocage
              </Champ>
              <Textarea
                id="description"
                name="description"
                required
                minLength={MIN_BLOCAGE}
                maxLength={LIMITE_BLOCAGE}
                rows={3}
                placeholder="Je bloque sur … car …"
              />
            </div>

            <fieldset>
              <legend className="mb-1.5 text-sm font-medium text-ink-900">Qui peut le voir ?</legend>
              <div className="space-y-2">
                {PORTEES.map((p) => (
                  <label key={p} className="flex cursor-pointer gap-3 rounded-lg border border-sand-200 px-3.5 py-3 text-sm has-checked:border-brand-600 has-checked:bg-brand-50">
                    <input type="radio" name="portee" value={p} defaultChecked={p === "group"} className="mt-0.5 size-4 accent-brand-700" />
                    <span>
                      <span className="font-medium text-ink-900">{PORTEE_LABELS[p]}</span>
                      <span className="block text-xs leading-relaxed text-slate-500">
                        {PORTEE_DESCRIPTIONS[p]} {recommandationPortee(p)}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          </AuthForm>
        </Panneau>
      )}
    </div>
  );
}

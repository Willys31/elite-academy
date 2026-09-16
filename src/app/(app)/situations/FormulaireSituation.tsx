import type { AuthState } from "@/app/(auth)/actions";
import { PORTEE_DESCRIPTIONS, PORTEE_LABELS, PORTEES, recommandationPortee, type Portee } from "@/lib/partage/visibilite";
import {
  AIDES_CSRR,
  LIMITES_CSRR,
  MAX_COMPETENCES,
  MAX_TAGS,
  SECTEUR_LABELS,
  SECTEURS,
  secteurParDefaut,
  type ChampsSituation,
  type Secteur,
} from "@/lib/situations/situations";
import { AuthForm } from "@/components/ui/AuthForm";
import { ChampCompte } from "@/components/ui/ChampCompte";
import { CLASSES_CHAMP, Input } from "@/components/ui";
import { Champ } from "@/components/app";

/**
 * Formulaire CSRR, partagé entre la soumission et la correction. Rendu
 * serveur ; seuls les compteurs de caractères sont des composants client.
 */
export function FormulaireSituation({
  action,
  formations,
  formationInitiale,
  submitLabel,
  valeurs,
  situationId,
}: {
  action: (prev: AuthState, formData: FormData) => Promise<AuthState>;
  formations: Array<{
    id: string;
    title: string;
    sector: string | null;
    sectorOrganisation: string | null;
    competences: Array<{ id: string; name: string }>;
  }>;
  formationInitiale: string | null;
  submitLabel: string;
  valeurs?: Partial<ChampsSituation> & {
    course_id?: string;
    sector?: string;
    visibility_scope?: string;
    is_anonymized?: boolean;
    competences?: string[];
    tags?: string[];
  };
  situationId?: string;
}) {
  const formationChoisie =
    formations.find((f) => f.id === (valeurs?.course_id ?? formationInitiale)) ?? formations[0];
  const secteurInitial: Secteur =
    (valeurs?.sector as Secteur | undefined) ??
    secteurParDefaut(formationChoisie?.sector, formationChoisie?.sectorOrganisation);
  const porteeInitiale = (valeurs?.visibility_scope as Portee | undefined) ?? "organization";
  const competencesChoisies = new Set(valeurs?.competences ?? []);

  return (
    <AuthForm action={action} submitLabel={submitLabel} pendingLabel="Envoi…">
      {situationId ? <input type="hidden" name="situation_id" value={situationId} /> : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Champ htmlFor="course_id">Formation</Champ>
          <select id="course_id" name="course_id" required className={CLASSES_CHAMP} defaultValue={formationChoisie?.id ?? ""}>
            {formations.map((f) => (
              <option key={f.id} value={f.id}>{f.title}</option>
            ))}
          </select>
        </div>
        <div>
          <Champ htmlFor="sector">Secteur</Champ>
          <select id="sector" name="sector" required className={CLASSES_CHAMP} defaultValue={secteurInitial}>
            {SECTEURS.map((s) => (
              <option key={s} value={s}>{SECTEUR_LABELS[s]}</option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <Champ htmlFor="title" hint={`${LIMITES_CSRR.title[0]} à ${LIMITES_CSRR.title[1]} caractères`}>Titre</Champ>
        <Input id="title" name="title" required minLength={LIMITES_CSRR.title[0]} maxLength={LIMITES_CSRR.title[1]} defaultValue={valeurs?.title ?? ""} placeholder={AIDES_CSRR.title} />
      </div>

      <ChampCompte name="context" label="Contexte" aide={AIDES_CSRR.context} min={LIMITES_CSRR.context[0]} max={LIMITES_CSRR.context[1]} rows={3} defaultValue={valeurs?.context ?? ""} />
      <ChampCompte name="situation" label="Situation" aide={AIDES_CSRR.situation} min={LIMITES_CSRR.situation[0]} max={LIMITES_CSRR.situation[1]} rows={5} defaultValue={valeurs?.situation ?? ""} />
      <ChampCompte name="resolution" label="Résolution" aide={AIDES_CSRR.resolution} min={LIMITES_CSRR.resolution[0]} max={LIMITES_CSRR.resolution[1]} rows={5} defaultValue={valeurs?.resolution ?? ""} />
      <ChampCompte name="result" label="Résultat" aide={AIDES_CSRR.result} min={LIMITES_CSRR.result[0]} max={LIMITES_CSRR.result[1]} rows={3} defaultValue={valeurs?.result ?? ""} />

      <fieldset>
        <legend className="mb-1.5 text-sm font-medium text-ink-900">
          Compétences mobilisées <span className="font-normal text-slate-500">(1 à {MAX_COMPETENCES})</span>
        </legend>
        <div className="grid gap-1.5 sm:grid-cols-2">
          {(formationChoisie ? [formationChoisie] : formations).flatMap((f) =>
            f.competences.map((k) => (
              <label key={k.id} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-sand-200 px-3 text-sm has-checked:border-brand-600 has-checked:bg-brand-50">
                <input type="checkbox" name="competency_ids" value={k.id} defaultChecked={competencesChoisies.has(k.id)} className="size-4 accent-brand-700" />
                {k.name}
              </label>
            ))
          )}
        </div>
        {formationChoisie && formationChoisie.competences.length === 0 ? (
          <p className="mt-1.5 text-xs text-slate-500">Cette formation n&apos;a pas encore de compétence rattachée.</p>
        ) : null}
      </fieldset>

      <fieldset>
        <legend className="mb-1.5 text-sm font-medium text-ink-900">Qui peut la lire ?</legend>
        <div className="space-y-2">
          {PORTEES.map((p) => (
            <label key={p} className="flex cursor-pointer gap-3 rounded-lg border border-sand-200 px-3.5 py-3 text-sm has-checked:border-brand-600 has-checked:bg-brand-50">
              <input type="radio" name="portee" value={p} defaultChecked={p === porteeInitiale} className="mt-0.5 size-4 accent-brand-700" />
              <span>
                <span className="font-medium text-ink-900">{PORTEE_LABELS[p]}</span>
                <span className="block text-xs leading-relaxed text-slate-500">{PORTEE_DESCRIPTIONS[p]} {recommandationPortee(p)}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm text-ink-900">
        <input type="checkbox" name="is_anonymized" defaultChecked={valeurs?.is_anonymized ?? false} className="size-4 accent-brand-700" />
        Anonymiser : masquer mon nom, afficher seulement le secteur
      </label>

      <div>
        <Champ htmlFor="tags" hint={`facultatif · ${MAX_TAGS} max, séparés par des virgules`}>Mots-clés</Champ>
        <Input id="tags" name="tags" defaultValue={(valeurs?.tags ?? []).join(", ")} placeholder="client VIP, réclamation, fidélisation" />
      </div>
    </AuthForm>
  );
}

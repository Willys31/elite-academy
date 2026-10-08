"use client";

import { useActionState, useState } from "react";
import type { ActionState } from "@/app/(app)/catalogue/actions";
import { importerDocument } from "@/app/(app)/catalogue/importer/actions";
import { TeleverseurFichier, type FichierTermine } from "@/components/stockage/TeleverseurFichier";
import { JaugeStockage } from "@/components/stockage/JaugeStockage";
import { ACCEPT_IMPORT, formaterTaille, TAILLE_MAX_EXTRACTION } from "@/lib/stockage/limites";
import { Alert, Input, Label, Select } from "@/components/ui";
import { GoldButton } from "@/components/public";

export interface OrganisationImport {
  id: string;
  name: string;
  usage: number;
  quota: number;
}

/**
 * Formulaire d'import d'un document de cours (lot 20).
 *
 * Deux temps : le document part d'abord directement vers Storage
 * (`TeleverseurFichier`), puis le formulaire envoie à l'action serveur
 * l'identifiant de la source, l'organisation, la méthode de découpage
 * et le titre. L'organisation se verrouille dès que l'envoi commence :
 * le chemin du fichier en dépend.
 */
export function FormulaireImport({ organisations }: { organisations: OrganisationImport[] }) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    importerDocument,
    {}
  );
  const [orgId, setOrgId] = useState(organisations[0]?.id ?? "");
  const [verrouille, setVerrouille] = useState(false);
  const [source, setSource] = useState<FichierTermine | null>(null);

  const org = organisations.find((o) => o.id === orgId) ?? organisations[0];

  return (
    <form action={formAction} className="space-y-4">
      {state.error ? <Alert kind="error">{state.error}</Alert> : null}
      {state.success ? <Alert kind="success">{state.success}</Alert> : null}

      <div>
        <Label htmlFor="organization_id">Organisation</Label>
        <Select
          id="organization_id"
          name="organization_id"
          required
          value={orgId}
          disabled={verrouille}
          onChange={(e) => setOrgId(e.target.value)}
        >
          {organisations.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </Select>
        {/* Un <select> désactivé n'est pas soumis : le champ caché porte la valeur. */}
        {verrouille ? <input type="hidden" name="organization_id" value={orgId} /> : null}
        {org ? (
          <div className="mt-2">
            <JaugeStockage usage={org.usage} quota={org.quota} compact />
          </div>
        ) : null}
      </div>

      <TeleverseurFichier
        key={orgId}
        organizationId={orgId}
        destination={{ type: "import" }}
        accept={ACCEPT_IMPORT}
        libelle={`Document de cours (.docx, .pdf ou .pptx, ${formaterTaille(TAILLE_MAX_EXTRACTION)} max pour l'analyse automatique)`}
        usageOctets={org?.usage}
        quotaOctets={org?.quota}
        surDebut={() => setVerrouille(true)}
        surTermine={(f) => setSource(f)}
        surReinitialisation={() => {
          setSource(null);
          setVerrouille(false);
        }}
      />
      <input type="hidden" name="source_id" value={source?.sourceId ?? ""} />

      <fieldset>
        <legend className="mb-2 block text-sm font-medium text-slate-700">
          Méthode de découpage
        </legend>
        <div className="space-y-2">
          <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-sand-200 px-3.5 py-3 text-sm transition duration-200 hover:border-sand-300 hover:bg-sand-50">
            <input
              type="radio"
              name="mode"
              value="ia"
              defaultChecked
              className="mt-0.5 h-4 w-4 accent-brand-700"
            />
            <span>
              <span className="font-medium">Découpage par IA (recommandé)</span>
              <span className="block text-xs text-slate-500">
                L&apos;IA réorganise le contenu en modules et leçons
                cohérents, en préservant la matière du document, et
                convertit les questions/exercices détectés en vrais QCM.
              </span>
            </span>
          </label>
          <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-sand-200 px-3.5 py-3 text-sm transition duration-200 hover:border-sand-300 hover:bg-sand-50">
            <input
              type="radio"
              name="mode"
              value="titres"
              className="mt-0.5 h-4 w-4 accent-brand-700"
            />
            <span>
              <span className="font-medium">Découpage simple par titres</span>
              <span className="block text-xs text-slate-500">
                Sans IA : Titre 1 → module, Titre 2 → leçon. Fiable
                uniquement si le document utilise bien les styles de
                titres Word.
              </span>
            </span>
          </label>
        </div>
      </fieldset>

      <div>
        <Label htmlFor="title">Titre de la formation (facultatif)</Label>
        <Input id="title" name="title" placeholder="Par défaut : le nom du fichier" />
      </div>

      <GoldButton type="submit" disabled={pending || !source} className="w-full">
        {pending ? (
          <>
            <span
              aria-hidden
              className="inline-block size-3.5 animate-spin rounded-full border-2 border-white/35 border-t-white"
            />
            Analyse du document en cours…
          </>
        ) : source ? (
          "Importer et créer le brouillon"
        ) : (
          "Téléversez d'abord le document"
        )}
      </GoldButton>
    </form>
  );
}

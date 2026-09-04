import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/profile";
import { isEliteAdmin } from "@/lib/auth/roles";
import { organizationsForCourseCreation } from "@/lib/courses/statuts";
import { createClient } from "@/lib/supabase/server";
import { importerDocument } from "@/app/(app)/catalogue/importer/actions";
import { iaConfiguree, modeSimulation } from "@/lib/ai/client";
import { AuthForm } from "@/components/ui/AuthForm";
import { Alert, BackLink, Card, Input, Label, PageTitle, Select } from "@/components/ui";

export const metadata: Metadata = { title: "Importer un document" };

/**
 * Import d'un document de cours (PRD §5) : le fichier est découpé
 * automatiquement en modules et leçons selon ses titres, et la
 * formation est créée en brouillon, prête à relire dans l'éditeur.
 */
export default async function ImporterPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/connexion");

  const elite = isEliteAdmin(user.memberships);
  let organisations = organizationsForCourseCreation(user.memberships).map((m) => ({
    id: m.organization_id,
    name: m.organization?.name ?? "Organisation",
  }));
  if (elite) {
    const supabase = await createClient();
    const { data } = await supabase.from("organizations").select("id, name").order("name");
    organisations = data ?? organisations;
  }
  if (organisations.length === 0) redirect("/sans-acces");

  return (
    <div className="max-w-2xl">
      <BackLink href="/catalogue">Catalogue</BackLink>
      <PageTitle>Importer un document de cours</PageTitle>
      <p className="-mt-4 mb-6 text-sm text-slate-500">
        Votre document devient une formation structurée en modules et
        leçons, créée en <strong>brouillon</strong> : vous relisez, ajustez,
        puis soumettez à validation. Le document original reste joint en
        support.
      </p>

      {modeSimulation() ? (
        <div className="mb-6">
          <Alert kind="info">
            Mode simulation actif : le découpage par IA retombera sur le
            découpage par titres. Pour la structuration intelligente, activez
            un fournisseur IA (gratuit possible : <code>LLM_PROVIDER=gemini</code>{" "}
            + <code>LLM_API_KEY</code> dans <code>.env.local</code>).
          </Alert>
        </div>
      ) : !iaConfiguree() ? (
        <div className="mb-6">
          <Alert kind="info">
            Astuce : le découpage par IA fonctionne avec un fournisseur{" "}
            <strong>gratuit</strong>. Créez une clé sur aistudio.google.com
            puis ajoutez <code>LLM_PROVIDER=gemini</code> et{" "}
            <code>LLM_API_KEY=…</code> dans <code>.env.local</code>. En
            attendant, le découpage par titres reste disponible.
          </Alert>
        </div>
      ) : null}

      <Card>
        <AuthForm
          action={importerDocument}
          submitLabel="Importer et créer le brouillon"
          pendingLabel="Analyse du document en cours…"
        >
          <div>
            <Label htmlFor="organization_id">Organisation</Label>
            <Select id="organization_id" name="organization_id" required>
              {organisations.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="file">Document de cours (.docx ou .pdf, 20 Mo max)</Label>
            <input
              id="file"
              name="file"
              type="file"
              required
              accept=".docx,.pdf,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              className="block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm file:mr-3 file:rounded-md file:border-0 file:bg-brand-50 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-brand-700"
            />
            <p className="mt-1 text-xs text-slate-500">
              Word (.docx) donne le meilleur résultat. Pour un PDF scanné
              (images), aucun texte n&apos;est extractible.
            </p>
          </div>
          <fieldset>
            <legend className="mb-2 block text-sm font-medium text-slate-700">
              Méthode de découpage
            </legend>
            <div className="space-y-2">
              <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-200 px-3 py-2.5 text-sm hover:bg-slate-50">
                <input
                  type="radio"
                  name="mode"
                  value="ia"
                  defaultChecked
                  className="mt-0.5 h-4 w-4 accent-brand-600"
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
              <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-200 px-3 py-2.5 text-sm hover:bg-slate-50">
                <input
                  type="radio"
                  name="mode"
                  value="titres"
                  className="mt-0.5 h-4 w-4 accent-brand-600"
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
            <Input
              id="title"
              name="title"
              placeholder="Par défaut : le nom du fichier"
            />
          </div>
        </AuthForm>
      </Card>
    </div>
  );
}

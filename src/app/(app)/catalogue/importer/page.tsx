import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/profile";
import { isEliteAdmin } from "@/lib/auth/roles";
import { organizationsForDesign } from "@/lib/courses/statuts";
import { createClient } from "@/lib/supabase/server";
import { lireUsagesStockage } from "@/lib/stockage/usage";
import { iaConfiguree, modeSimulation } from "@/lib/ai/client";
import { FormulaireImport } from "@/components/stockage/FormulaireImport";
import { Alert, Card, PageTitle, Retour } from "@/components/ui";

export const metadata: Metadata = { title: "Importer un document" };

/**
 * Durée maximale de l'action serveur (Vercel Pro) : relecture d'un
 * document jusqu'à 100 Mo depuis Storage, extraction du texte, appel
 * au service IA. Les actions héritent de la configuration du segment
 * qui les invoque : c'est cette page qui appelle `importerDocument`.
 */
export const maxDuration = 300;

/**
 * Import d'un document de cours (PRD §5) : le fichier est découpé
 * automatiquement en modules et leçons selon ses titres, et la
 * formation est créée en brouillon, prête à relire dans l'éditeur.
 *
 * Depuis le lot 20, le document part directement du navigateur vers
 * Storage (gros fichiers, reprise sur coupure) ; l'action serveur ne
 * reçoit que son identifiant.
 */
export default async function ImporterPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/connexion");

  const elite = isEliteAdmin(user.memberships);
  const supabase = await createClient();

  /* Le téléversement direct est soumis aux politiques Storage et
     `sources_insert` (admin et concepteur) : proposer une organisation
     où l'utilisateur n'est que formateur ferait échouer l'envoi. */
  let organisations = organizationsForDesign(user.memberships).map((m) => ({
    id: m.organization_id,
    name: m.organization?.name ?? "Organisation",
  }));
  if (elite) {
    const { data } = await supabase.from("organizations").select("id, name").order("name");
    organisations = data ?? organisations;
  }
  if (organisations.length === 0) redirect("/sans-acces");

  const usages = await lireUsagesStockage(
    supabase,
    organisations.map((o) => o.id)
  );
  const organisationsAvecUsage = organisations.map((o) => ({
    ...o,
    usage: usages.get(o.id)?.usage ?? 0,
    quota: usages.get(o.id)?.quota ?? 0,
  }));

  return (
    <div className="max-w-2xl">
      <Retour href="/catalogue" ton="sobre" />
      <PageTitle>Importer un document de cours</PageTitle>
      <p className="-mt-4 mb-6 text-sm text-slate-500">
        Votre document (Word, PDF ou PowerPoint) devient une formation
        structurée en modules et leçons, créée en <strong>brouillon</strong> :
        vous relisez, ajustez le découpage, puis soumettez à validation.
        Chaque leçon reçoit les pages ou diapositives du document qui la
        concernent ; le document original reste dans vos Sources.
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
        <FormulaireImport organisations={organisationsAvecUsage} />
      </Card>
    </div>
  );
}

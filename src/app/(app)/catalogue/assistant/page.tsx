import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/profile";
import { isEliteAdmin } from "@/lib/auth/roles";
import { organizationsForCourseCreation } from "@/lib/courses/statuts";
import { createClient } from "@/lib/supabase/server";
import { genererFormation } from "@/app/(app)/catalogue/assistant/actions";
import { iaConfiguree, modeSimulation } from "@/lib/ai/client";
import { AuthForm } from "@/components/ui/AuthForm";
import { Alert, BackLink, Card, Input, Label, PageTitle, Select, Textarea } from "@/components/ui";

export const metadata: Metadata = { title: "Assistant de création IA" };

/**
 * Assistant de création (UX/UI §5.2) : le concepteur décrit son
 * besoin en langage naturel ; l'IA propose une formation complète
 * enregistrée en brouillon, à relire puis soumettre à validation.
 */
export default async function AssistantPage() {
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

  const simulation = modeSimulation();
  const cleConfiguree = simulation || iaConfiguree();

  return (
    <div className="max-w-2xl">
      <BackLink href="/catalogue">Catalogue</BackLink>
      <PageTitle>Assistant de création IA</PageTitle>
      <p className="-mt-4 mb-6 text-sm text-slate-500">
        Décrivez votre besoin : l&apos;IA analyse le sujet et le public,
        choisit les méthodes pédagogiques adaptées (jamais de méthode
        commerciale imposée à un sujet non commercial) et produit un
        <strong> brouillon complet</strong> — fiche, compétences, modules et
        leçons — que vous relirez avant de le soumettre à validation.
      </p>

      {simulation ? (
        <div className="mb-6">
          <Alert kind="info">
            <strong>Mode simulation activé</strong> : aucune clé API n&apos;est
            utilisée. Le contenu produit est un exemple de démonstration,
            clairement étiqueté, destiné uniquement à tester le parcours de
            création et de validation. Retirez <code>ELITE_IA_MODE=simulation</code>{" "}
            de <code>.env.local</code> pour activer la vraie génération.
          </Alert>
        </div>
      ) : null}

      {!cleConfiguree ? (
        <div className="mb-6">
          <Alert kind="error">
            Aucune IA configurée. Trois options dans <code>.env.local</code>{" "}
            (voir <code>.env.example</code>) : un fournisseur{" "}
            <strong>gratuit</strong> (<code>LLM_PROVIDER=gemini</code> +{" "}
            <code>LLM_API_KEY</code>), une clé <code>ANTHROPIC_API_KEY</code>,
            ou le mode <code>ELITE_IA_MODE=simulation</code>. Redémarrez
            ensuite l&apos;application.
          </Alert>
        </div>
      ) : null}

      <Card>
        <AuthForm
          action={genererFormation}
          submitLabel="Générer la formation (brouillon)"
          pendingLabel="Génération en cours — cela peut prendre une à deux minutes…"
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
            <Label htmlFor="sujet">Besoin de formation (obligatoire)</Label>
            <Textarea
              id="sujet"
              name="sujet"
              rows={4}
              required
              placeholder="Ex. : Créer une formation pour des managers débutants sur la gestion des conflits internes, avec des exemples adaptés aux entreprises ivoiriennes, des études de cas et une évaluation finale."
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="public_cible">Public cible</Label>
              <Input id="public_cible" name="public_cible" placeholder="Ex. : managers débutants" />
            </div>
            <div>
              <Label htmlFor="secteur">Secteur</Label>
              <Input id="secteur" name="secteur" placeholder="Ex. : santé, banque, restauration…" />
            </div>
            <div>
              <Label htmlFor="duree">Durée souhaitée</Label>
              <Input id="duree" name="duree" placeholder="Ex. : 1 jour, 6 heures…" />
            </div>
            <div>
              <Label htmlFor="niveau">Niveau visé</Label>
              <Select id="niveau" name="niveau" defaultValue="">
                <option value="">Laisser l&apos;IA proposer</option>
                <option value="Fondamentaux">Fondamentaux</option>
                <option value="Opérationnel">Opérationnel</option>
                <option value="Avancé">Avancé</option>
                <option value="Elite">Elite</option>
              </Select>
            </div>
          </div>
          <div>
            <Label htmlFor="notions_obligatoires">Notions obligatoires (facultatif)</Label>
            <Textarea
              id="notions_obligatoires"
              name="notions_obligatoires"
              rows={2}
              placeholder="Notions qui doivent absolument être traitées, séparées par des virgules."
            />
          </div>
          <div>
            <Label htmlFor="contexte">Contexte particulier (facultatif)</Label>
            <Textarea
              id="contexte"
              name="contexte"
              rows={2}
              placeholder="Procédures internes, contraintes, environnement de travail…"
            />
          </div>
        </AuthForm>
        <p className="mt-4 text-xs text-slate-400">
          Chaque génération est tracée (demandeur, brief, version du prompt,
          modèle, résultat). Le contenu généré reste un brouillon : rien
          n&apos;est publié sans validation humaine.
        </p>
      </Card>
    </div>
  );
}

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/profile";
import { activeMemberships, ORG_TYPE_LABELS, ROLE_LABELS } from "@/lib/auth/roles";
import { STATUTS_AVEC_ACCES } from "@/lib/courses/inscriptions";
import {
  changerMotDePasse,
  mettreAJourIdentite,
} from "@/app/(app)/profil/actions";
import { AuthForm } from "@/components/ui/AuthForm";
import {
  Champ,
  Chiffre,
  EcranTitre,
  Etiquette,
  LienSobre,
  Panneau,
  Saisie,
  SectionTitre,
} from "@/components/app";

export const metadata: Metadata = { title: "Mon profil" };

/**
 * Mon profil : ce que la plateforme sait de vous, et les deux seules
 * choses que vous pouvez y changer vous-même — votre nom et votre mot
 * de passe.
 *
 * Le rôle et l'organisation sont affichés en lecture seule à dessein :
 * ils sont attribués par l'encadrement, et un champ modifiable ici
 * laisserait croire le contraire. L'écran dit donc à qui s'adresser.
 */
export default async function ProfilPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/connexion");

  const memberships = activeMemberships(user.memberships);
  const supabase = await createClient();

  const [
    { count: nbFormations },
    { count: nbLecons },
    { data: competences },
    { count: nbCertificats },
  ] = await Promise.all([
    supabase
      .from("enrollments")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .in("status", [...STATUTS_AVEC_ACCES]),
    supabase
      .from("progress_records")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .not("lesson_id", "is", null),
    supabase
      .from("progress_records")
      .select("mastery_level")
      .eq("user_id", user.id)
      .not("competency_id", "is", null),
    supabase
      .from("certificates")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .eq("status", "valid"),
  ]);

  const nbCompetences = (competences ?? []).filter(
    (c) => c.mastery_level !== null
  ).length;

  return (
    <div>
      <EcranTitre
        eyebrow="Votre compte"
        intro="Votre nom apparaît sur vos certificats : c'est celui qu'un recruteur verra en vérifiant un code."
      >
        Mon profil
      </EcranTitre>

      {/* ---------- Résumé de parcours ---------- */}
      <dl className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Chiffre valeur={nbFormations ?? 0} libelle="Formations" detail="suivies" href="/formations" />
        <Chiffre valeur={nbLecons ?? 0} libelle="Leçons" detail="terminées" />
        <Chiffre
          valeur={nbCompetences}
          libelle="Compétences"
          detail="avec un niveau"
          href="/progression"
        />
        <Chiffre
          valeur={nbCertificats ?? 0}
          libelle="Certificats"
          detail="valides"
          href="/certificats"
        />
      </dl>

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        {/* ---------- Identité ---------- */}
        <Panneau>
          <SectionTitre>Identité</SectionTitre>
          <AuthForm
            action={mettreAJourIdentite}
            submitLabel="Enregistrer"
            pendingLabel="Enregistrement…"
          >
            <div>
              <Champ htmlFor="full_name">Nom complet</Champ>
              <Saisie
                id="full_name"
                name="full_name"
                type="text"
                autoComplete="name"
                required
                minLength={2}
                maxLength={120}
                defaultValue={user.fullName}
                placeholder="Prénom et nom"
              />
            </div>
            <div>
              {/* L'e-mail identifie le compte auprès de Supabase : le
                  changer suppose une revalidation par courriel, qui n'est
                  pas encore en place. Le champ reste donc visible mais
                  désactivé, avec la marche à suivre. */}
              <Champ htmlFor="email" hint="non modifiable ici">
                Adresse e-mail
              </Champ>
              <Saisie id="email" type="email" value={user.email} disabled readOnly />
              <p className="mt-1.5 text-xs text-slate-500">
                Pour changer d&apos;adresse, demandez à votre responsable
                d&apos;organisation ou à Elite Experience.
              </p>
            </div>
          </AuthForm>
        </Panneau>

        {/* ---------- Sécurité ---------- */}
        <Panneau>
          <SectionTitre>Mot de passe</SectionTitre>
          <p className="mb-4 text-sm leading-relaxed text-slate-600">
            Choisissez un mot de passe d&apos;au moins 8 caractères. Vous
            resterez connecté sur cet appareil.
          </p>
          <AuthForm
            action={changerMotDePasse}
            submitLabel="Modifier le mot de passe"
            pendingLabel="Modification…"
          >
            <div>
              <Champ htmlFor="password" hint="8 caractères minimum">
                Nouveau mot de passe
              </Champ>
              <Saisie
                id="password"
                name="password"
                type="password"
                autoComplete="new-password"
                minLength={8}
                required
              />
            </div>
            <div>
              <Champ htmlFor="confirm">Confirmer le mot de passe</Champ>
              <Saisie
                id="confirm"
                name="confirm"
                type="password"
                autoComplete="new-password"
                minLength={8}
                required
              />
            </div>
          </AuthForm>
        </Panneau>
      </div>

      {/* ---------- Organisations ---------- */}
      <section className="mt-8">
        <SectionTitre compte={memberships.length}>
          Mes organisations
        </SectionTitre>
        {memberships.length === 0 ? (
          <Panneau>
            <p className="text-sm leading-relaxed text-slate-600">
              Vous n&apos;êtes rattaché à aucune organisation. Sans
              rattachement, aucune formation ne peut vous être proposée :
              demandez à votre responsable ou à Elite Experience de vous
              ajouter.
            </p>
          </Panneau>
        ) : (
          <Panneau flush>
            <ul className="divide-y divide-sand-200">
              {memberships.map((m) => (
                <li
                  key={m.organization_id}
                  className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-5 py-4"
                >
                  <div className="min-w-0">
                    <p className="font-medium text-ink-900">
                      {m.organization?.name ?? "Organisation"}
                    </p>
                    {m.organization?.type ? (
                      <p className="text-xs text-slate-400">
                        {ORG_TYPE_LABELS[m.organization.type] ??
                          m.organization.type}
                      </p>
                    ) : null}
                  </div>
                  <Etiquette ton="or">{ROLE_LABELS[m.role]}</Etiquette>
                </li>
              ))}
            </ul>
          </Panneau>
        )}
        <p className="mt-3 text-xs leading-relaxed text-slate-500">
          Votre rôle est attribué par votre organisation. Il détermine ce que
          vous voyez dans le menu et ne se modifie pas depuis cet écran.
        </p>
      </section>

      {/* ---------- Certificats ---------- */}
      <section className="mt-8">
        <Panneau ton="or">
          <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
            <div className="min-w-0">
              <h2 className="font-display text-lg font-semibold text-ink-900">
                Vos certificats sont publics
              </h2>
              <p className="mt-1 max-w-lg text-sm leading-relaxed text-slate-600">
                Chaque certificat porte un code unique. Toute personne à qui
                vous le communiquez peut en vérifier l&apos;authenticité, sans
                compte et sans voir le reste de votre profil.
              </p>
            </div>
            <LienSobre href="/certificats">Mes certificats</LienSobre>
          </div>
        </Panneau>
      </section>
    </div>
  );
}

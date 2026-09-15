import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/profile";
import { isEliteAdmin, ROLE_LABELS, type MemberRole } from "@/lib/auth/roles";
import { roleInOrg, STATUS_LABELS, type CourseStatus } from "@/lib/courses/statuts";
import {
  peutAffecterFormateurs,
  peutEtreAffecte,
} from "@/lib/courses/affectations";
import {
  affecterFormateur,
  retirerFormateur,
} from "@/app/(app)/catalogue/[id]/formateurs/actions";
import { AuthForm } from "@/components/ui/AuthForm";
import { Champ, EcranTitre, Etiquette, LienSobre, Panneau, Retour, SectionTitre, Vide } from "@/components/app";

export const metadata: Metadata = { title: "Formateurs de la formation" };

const CLASSES_SELECT =
  "block min-h-11 w-full rounded-xl border border-sand-200 bg-sand-50/60 px-3.5 py-2.5 text-base text-ink-900 outline-none transition duration-200 focus:border-gold-400 focus:bg-white focus:ring-4 focus:ring-gold-300/25 sm:text-sm";

/**
 * Qui anime cette formation.
 *
 * Écran réservé à l'administrateur et au responsable d'organisation :
 * l'affectation est un acte d'organisation. Un formateur qui arrive ici
 * voit la liste en lecture seule — savoir avec qui on travaille n'a
 * rien de confidentiel, décider qui anime, si.
 */
export default async function FormateursFormationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/connexion");
  const { id } = await params;

  const supabase = await createClient();
  const { data: formation } = await supabase
    .from("courses")
    .select("id, title, status, organization_id, owner_id, organization:organizations(name)")
    .eq("id", id)
    .maybeSingle();

  if (!formation) notFound();

  const org = Array.isArray(formation.organization)
    ? formation.organization[0]
    : formation.organization;

  const peutAffecter = peutAffecterFormateurs(
    roleInOrg(user.memberships, formation.organization_id),
    isEliteAdmin(user.memberships)
  );

  const [{ data: affectes }, { data: membres }] = await Promise.all([
    supabase
      .from("course_trainers")
      .select("user_id, created_at")
      .eq("course_id", id),
    supabase
      .from("organization_members")
      .select("user_id, role, status")
      .eq("organization_id", formation.organization_id)
      .eq("status", "active"),
  ]);

  /* Noms : un seul aller-retour pour l'ensemble des personnes
     concernées, affectées comme affectables. */
  const idsConcernes = [
    ...new Set([
      ...(affectes ?? []).map((a) => a.user_id as string),
      ...(membres ?? []).map((m) => m.user_id as string),
      formation.owner_id as string,
    ]),
  ].filter(Boolean);

  const noms = new Map<string, string>();
  if (idsConcernes.length > 0) {
    const { data: profils } = await supabase
      .from("profiles")
      .select("id, full_name, email")
      .in("id", idsConcernes);
    for (const p of profils ?? []) {
      noms.set(
        p.id as string,
        (p.full_name as string) || (p.email as string) || "Utilisateur"
      );
    }
  }

  const rolesParUtilisateur = new Map<string, MemberRole>();
  for (const m of membres ?? []) {
    rolesParUtilisateur.set(m.user_id as string, m.role as MemberRole);
  }

  const listeAffectes = (affectes ?? []).map((a) => ({
    userId: a.user_id as string,
    nom: noms.get(a.user_id as string) ?? "Utilisateur",
    role: rolesParUtilisateur.get(a.user_id as string) ?? null,
    depuis: a.created_at as string,
  }));

  const dejaAffectes = new Set(listeAffectes.map((a) => a.userId));
  const affectables = (membres ?? [])
    .filter((m) => peutEtreAffecte(m.role as string))
    .filter((m) => !dejaAffectes.has(m.user_id as string))
    .map((m) => ({
      userId: m.user_id as string,
      nom: noms.get(m.user_id as string) ?? "Utilisateur",
      role: m.role as MemberRole,
    }))
    .sort((a, b) => a.nom.localeCompare(b.nom, "fr"));

  const proprietaire = formation.owner_id
    ? noms.get(formation.owner_id as string)
    : null;

  return (
    <div>
      <Retour href={`/catalogue/${id}`} />

      <EcranTitre
        eyebrow={[org?.name, STATUS_LABELS[formation.status as CourseStatus]]
          .filter(Boolean)
          .join(" · ")}
        intro="Un formateur affecté peut ouvrir des sessions sur cette formation et consulter ses résultats. Il ne peut pas en modifier le contenu : seul son concepteur le peut."
        action={<LienSobre href={`/resultats?formation=${id}`}>Résultats</LienSobre>}
      >
        Qui anime « {formation.title} »
      </EcranTitre>

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        {/* ---------- Formateurs affectés ---------- */}
        <section>
          <SectionTitre compte={listeAffectes.length}>
            Formateurs affectés
          </SectionTitre>

          {listeAffectes.length === 0 ? (
            <Vide
              titre="Personne n'est encore affecté"
              texte={
                peutAffecter
                  ? "Désignez au moins un formateur : il verra cette formation dans son espace et pourra ouvrir des sessions dessus."
                  : "Aucun formateur n'a encore été désigné pour cette formation."
              }
            />
          ) : (
            <Panneau flush>
              <ul className="divide-y divide-sand-200">
                {listeAffectes.map((a) => (
                  <li
                    key={a.userId}
                    className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 px-5 py-4"
                  >
                    <div className="min-w-0">
                      <p className="font-medium text-ink-900">{a.nom}</p>
                      <p className="text-xs text-slate-400">
                        {[
                          a.role ? ROLE_LABELS[a.role] : null,
                          `depuis le ${new Date(a.depuis).toLocaleDateString(
                            "fr-FR",
                            { day: "numeric", month: "long", year: "numeric" }
                          )}`,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    </div>
                    {peutAffecter ? (
                      <AuthForm
                        action={retirerFormateur}
                        submitLabel="Retirer"
                        pendingLabel="Retrait…"
                        ton="sobre"
                      >
                        <input type="hidden" name="course_id" value={id} />
                        <input type="hidden" name="user_id" value={a.userId} />
                      </AuthForm>
                    ) : null}
                  </li>
                ))}
              </ul>
            </Panneau>
          )}

          {proprietaire ? (
            <p className="mt-4 border-l-2 border-gold-400 pl-4 text-sm leading-relaxed text-slate-600">
              Cette formation a été conçue par <strong>{proprietaire}</strong>.
              Le concepteur y a accès sans affectation : c&apos;est son
              contenu, il en garde la main.
            </p>
          ) : null}
        </section>

        {/* ---------- Affecter quelqu'un ---------- */}
        {peutAffecter ? (
          <section>
            <SectionTitre>Affecter un formateur</SectionTitre>
            <Panneau>
              {affectables.length === 0 ? (
                <p className="text-sm leading-relaxed text-slate-600">
                  {listeAffectes.length > 0
                    ? "Tous les formateurs de l'organisation sont déjà affectés à cette formation."
                    : "Aucun membre de cette organisation ne peut animer une formation. Ajoutez d'abord un formateur à l'organisation."}
                </p>
              ) : (
                <AuthForm
                  action={affecterFormateur}
                  submitLabel="Affecter"
                  pendingLabel="Affectation…"
                >
                  <input type="hidden" name="course_id" value={id} />
                  <div>
                    <Champ htmlFor="user_id">Personne</Champ>
                    <select
                      id="user_id"
                      name="user_id"
                      required
                      defaultValue=""
                      className={CLASSES_SELECT}
                    >
                      <option value="" disabled>
                        — Choisir —
                      </option>
                      {affectables.map((m) => (
                        <option key={m.userId} value={m.userId}>
                          {m.nom} — {ROLE_LABELS[m.role]}
                        </option>
                      ))}
                    </select>
                    <p className="mt-1.5 text-xs leading-relaxed text-slate-500">
                      Seuls les formateurs, concepteurs et administrateurs de
                      l&apos;organisation apparaissent ici. Un responsable
                      pilote, il n&apos;anime pas.
                    </p>
                  </div>
                </AuthForm>
              )}
            </Panneau>
          </section>
        ) : (
          <section>
            <Panneau>
              <SectionTitre>Lecture seule</SectionTitre>
              <p className="text-sm leading-relaxed text-slate-600">
                Seuls l&apos;administrateur et le responsable de
                l&apos;organisation désignent les formateurs. Vous pouvez voir
                qui anime cette formation, pas modifier la liste.
              </p>
            </Panneau>
          </section>
        )}
      </div>
    </div>
  );
}

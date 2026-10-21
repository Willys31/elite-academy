import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/profile";
import { encadreUneOrganisation } from "@/lib/auth/roles";
import type { ResultatCorrection } from "@/lib/courses/progression";
import { resumerPropositions, type PropositionsCopie } from "@/lib/ai/precorrection";
import { estActiviteRedigee, TYPE_ACTIVITE_REDIGEE_LABELS } from "@/lib/courses/activites-redigees";
import { EcranTitre, Etiquette, LienSobre, PanneauLien, Retour, SectionTitre, Vide } from "@/components/app";

export const metadata: Metadata = { title: "Copies à corriger" };

/**
 * Copies à corriger (lot 23 ; lot 27 bis : repli seulement). Les
 * réponses rédigées sont corrigées automatiquement dès l'envoi et
 * relancées d'elles-mêmes en cas d'échec : une copie n'apparaît ici que
 * tant que cette correction n'a pas abouti (service indisponible, quota
 * atteint, mode désactivé). La RLS (`attempts_select` :
 * `oversees_activity`) fait le tri — on exclut seulement ses propres
 * tentatives, qu'elle laisse passer aussi.
 *
 * De la plus ancienne à la plus récente : la copie qui attend depuis
 * le plus longtemps est celle à prendre en premier.
 */
export default async function CorrectionsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/connexion");

  if (!encadreUneOrganisation(user.memberships)) {
    return (
      <div>
        <Retour href="/resultats" />
        <EnTete />
        <Vide
          titre="Vous n'encadrez aucune formation"
          texte="La correction des questions ouvertes est réservée aux formateurs, concepteurs et responsables d'une organisation."
          action={<LienSobre href="/accueil">Retour au tableau de bord</LienSobre>}
        />
      </div>
    );
  }

  const supabase = await createClient();
  const { data: copies } = await supabase
    .from("attempts")
    .select("id, user_id, activity_id, submitted_at, feedback, activity:activities(title, type), review:attempt_ai_reviews(proposal)")
    .eq("status", "pending_review")
    .neq("user_id", user.id)
    .order("submitted_at", { ascending: true })
    .limit(200);

  const idsApprenants = [...new Set((copies ?? []).map((c) => c.user_id as string))];
  const noms = new Map<string, string>();
  if (idsApprenants.length > 0) {
    const { data: profils } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", idsApprenants);
    for (const p of profils ?? []) noms.set(p.id as string, (p.full_name as string) || "Apprenant");
  }

  const liste = (copies ?? []).map((c) => {
    const activite = Array.isArray(c.activity) ? c.activity[0] : c.activity;
    const feedback = c.feedback as ResultatCorrection | null;
    const revue = Array.isArray(c.review) ? c.review[0] : c.review;
    return {
      id: c.id as string,
      nom: noms.get(c.user_id as string) ?? "Apprenant",
      titreActivite: activite?.title ?? "Activité",
      typeActivite: estActiviteRedigee(activite?.type) ? TYPE_ACTIVITE_REDIGEE_LABELS[activite.type] : null,
      nbEnAttente: feedback?.nbEnAttente ?? 0,
      date: c.submitted_at as string | null,
      ia: resumerPropositions((revue?.proposal ?? null) as PropositionsCopie | null),
    };
  });

  return (
    <div>
      <Retour href="/resultats" />
      <EnTete />

      {liste.length === 0 ? (
        <Vide
          titre="Aucune copie en attente"
          texte="Les réponses rédigées sont corrigées automatiquement dès l'envoi. Une copie n'apparaît ici que si cette correction n'a pas pu aboutir ; elle est relancée d'elle-même dès que l'apprenant revient sur l'activité."
          action={<LienSobre href="/resultats">Voir les résultats</LienSobre>}
        />
      ) : (
        <section>
          <SectionTitre compte={liste.length}>Correction automatique non aboutie</SectionTitre>
          <ul className="space-y-3">
            {liste.map((c) => (
              <li key={c.id}>
                <PanneauLien href={`/resultats/corrections/${c.id}`}>
                  <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                    <div className="min-w-0">
                      <p className="font-medium text-ink-900">{c.nom}</p>
                      <p className="text-xs text-slate-500">
                        {c.typeActivite ? `${c.typeActivite} · ` : ""}
                        {c.titreActivite}
                        {c.date
                          ? ` · remise le ${new Date(c.date).toLocaleString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}`
                          : ""}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {c.ia ? <Etiquette>{c.ia}</Etiquette> : null}
                      <Etiquette ton="or">
                        {c.nbEnAttente} {c.typeActivite ? "réponse" : "question"}{c.nbEnAttente > 1 ? "s" : ""} à noter
                      </Etiquette>
                    </div>
                  </div>
                </PanneauLien>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function EnTete() {
  return (
    <EcranTitre
      eyebrow="Vue formateur"
      intro="Les réponses rédigées sont corrigées automatiquement dès l'envoi, sans intervention. Cette file ne montre que les copies dont la correction n'a pas abouti : vous pouvez les noter vous-même, ou laisser la relance automatique faire. Pour revoir une copie déjà notée, ouvrez-la depuis les résultats."
    >
      Copies à corriger
    </EcranTitre>
  );
}

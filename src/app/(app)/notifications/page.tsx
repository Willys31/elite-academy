import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/profile";
import {
  dateRelative,
  libelleType,
  regrouperParJour,
  type NotificationResume,
} from "@/lib/notifications/notifications";
import { marquerLue, toutMarquerLu } from "@/app/(app)/notifications/actions";
import { AuthForm } from "@/components/ui/AuthForm";
import { EcranTitre, LienSobre, Panneau, Retour, Vide } from "@/components/app";

export const metadata: Metadata = { title: "Notifications" };

const PAR_PAGE = 30;

/**
 * Toutes les notifications, groupées par jour. La cloche n'en montre que
 * les dernières ; cet écran est l'historique complet.
 */
export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/connexion");

  const params = await searchParams;
  const page = Math.max(1, parseInt(params.page ?? "1", 10) || 1);
  const depuis = (page - 1) * PAR_PAGE;

  const supabase = await createClient();
  const [{ data: lignes, count }, { count: nonLues }] = await Promise.all([
    supabase
      .from("notifications")
      .select("id, type, title, body, href, read_at, created_at", { count: "exact" })
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .range(depuis, depuis + PAR_PAGE - 1),
    supabase
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .is("read_at", null),
  ]);

  const notifications = (lignes ?? []) as NotificationResume[];
  const total = count ?? 0;
  const nbPages = Math.max(1, Math.ceil(total / PAR_PAGE));
  const groupes = regrouperParJour(notifications);

  return (
    <div className="mx-auto max-w-3xl">
      <Retour href="/accueil" />
      <EcranTitre
        eyebrow="Votre compte"
        intro="Badges, aides reçues, sessions, alertes : tout ce que la plateforme vous a signalé."
        action={
          (nonLues ?? 0) > 0 ? (
            <AuthForm
              action={toutMarquerLu}
              submitLabel="Tout marquer lu"
              pendingLabel="Marquage…"
              ton="sobre"
            >
              {null}
            </AuthForm>
          ) : null
        }
      >
        Notifications
      </EcranTitre>

      {notifications.length === 0 ? (
        <Vide
          titre="Aucune notification"
          texte="Vous serez prévenu ici quand un badge tombe, qu'un pair vous aide ou qu'une session se termine."
          action={<LienSobre href="/accueil">Retour à l'accueil</LienSobre>}
        />
      ) : (
        <div className="space-y-8">
          {groupes.map((g) => (
            <section key={g.cle}>
              <h2 className="mb-3 text-sm font-semibold text-slate-500 first-letter:uppercase">
                {g.libelle}
              </h2>
              <Panneau flush>
                <ul className="divide-y divide-sand-100">
                  {g.notifications.map((n) => (
                    <li key={n.id} className="flex gap-3 px-5 py-4">
                      <span
                        aria-hidden
                        className={`mt-2 size-2 shrink-0 rounded-full ${
                          n.read_at === null ? "bg-brand-600" : "bg-transparent"
                        }`}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-medium text-slate-500">
                          {libelleType(n.type)} · {dateRelative(n.created_at)}
                        </p>
                        <p
                          className={`mt-0.5 text-sm ${
                            n.read_at === null ? "font-medium text-ink-900" : "text-slate-700"
                          }`}
                        >
                          {n.href ? (
                            <Link href={n.href} className="hover:underline">
                              {n.title}
                            </Link>
                          ) : (
                            n.title
                          )}
                        </p>
                        {n.body ? (
                          <p className="mt-1 text-sm leading-relaxed text-slate-600">{n.body}</p>
                        ) : null}
                      </div>
                      {n.read_at === null ? (
                        <form
                          action={async (fd) => {
                            "use server";
                            await marquerLue({}, fd);
                          }}
                          className="shrink-0"
                        >
                          <input type="hidden" name="notification_id" value={n.id} />
                          <button
                            type="submit"
                            className="rounded-md px-2 py-1 text-xs font-medium text-slate-500 transition-colors duration-150 hover:bg-sand-100 hover:text-ink-900"
                          >
                            Marquer lue
                          </button>
                        </form>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </Panneau>
            </section>
          ))}

          {nbPages > 1 ? (
            <nav aria-label="Pages" className="flex items-center justify-between text-sm">
              {page > 1 ? (
                <LienSobre href={`/notifications?page=${page - 1}`}>Plus récentes</LienSobre>
              ) : (
                <span />
              )}
              <span className="text-slate-500">
                Page {page} sur {nbPages}
              </span>
              {page < nbPages ? (
                <LienSobre href={`/notifications?page=${page + 1}`}>Plus anciennes</LienSobre>
              ) : (
                <span />
              )}
            </nav>
          ) : null}
        </div>
      )}
    </div>
  );
}

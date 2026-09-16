"use client";

import { useActionState, useCallback, useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  dateRelative,
  libelleType,
  tronquer,
  type NotificationResume,
} from "@/lib/notifications/notifications";
import { marquerLue, toutMarquerLu } from "@/app/(app)/notifications/actions";
import type { ActionState } from "@/app/(app)/catalogue/actions";
import { Icone } from "@/components/icons";

/**
 * Cloche de notifications du cadre applicatif.
 *
 * Les données arrivent du serveur (`(app)/layout.tsx`), donc filtrées
 * par RLS. Le composant s'abonne au temps réel sur ses propres lignes et
 * redemande le cadre au serveur à chaque insertion : la pastille se met
 * à jour sans rechargement, sans jamais lire la base depuis le
 * navigateur (même mécanisme que `SessionRealtimeRefresh`).
 *
 * Le panneau reprend les règles du tiroir de navigation : fermeture à
 * la touche Échap, au clic extérieur et au changement de page.
 */
export function ClocheNotifications({
  userId,
  nonLues,
  recentes,
}: {
  userId: string;
  nonLues: number;
  recentes: NotificationResume[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [ouvert, setOuvert] = useState(false);
  const racineRef = useRef<HTMLDivElement>(null);
  const fermer = useCallback(() => setOuvert(false), []);
  /* La cloche est montée deux fois (barre latérale et en-tête mobile,
     une seule visible à la fois) : chaque instance a son identifiant
     de panneau et son canal temps réel. */
  const idPanneau = useId();

  const [, actionToutLu, enCours] = useActionState<ActionState, FormData>(
    toutMarquerLu,
    {}
  );

  useEffect(() => {
    setOuvert(false);
  }, [pathname]);

  useEffect(() => {
    if (!ouvert) return;
    const surTouche = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOuvert(false);
    };
    const surClic = (e: MouseEvent) => {
      if (racineRef.current && !racineRef.current.contains(e.target as Node)) {
        setOuvert(false);
      }
    };
    document.addEventListener("keydown", surTouche);
    document.addEventListener("mousedown", surClic);
    return () => {
      document.removeEventListener("keydown", surTouche);
      document.removeEventListener("mousedown", surClic);
    };
  }, [ouvert]);

  useEffect(() => {
    const supabase = createClient();
    const rafraichir = () => router.refresh();
    const canal = supabase
      .channel(`notifications-${userId}-${idPanneau}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${userId}`,
        },
        rafraichir
      )
      .subscribe();
    window.addEventListener("online", rafraichir);
    return () => {
      window.removeEventListener("online", rafraichir);
      supabase.removeChannel(canal);
    };
  }, [userId, router, idPanneau]);

  const libellePastille =
    nonLues === 0
      ? "Notifications"
      : `Notifications : ${nonLues} non lue${nonLues > 1 ? "s" : ""}`;

  return (
    <div ref={racineRef} className="relative">
      <button
        type="button"
        onClick={() => setOuvert((v) => !v)}
        aria-expanded={ouvert}
        aria-controls={idPanneau}
        aria-label={libellePastille}
        title={libellePastille}
        className="relative inline-flex size-11 items-center justify-center rounded-lg text-slate-500 transition-colors duration-150 hover:bg-sand-100 hover:text-ink-900 lg:size-10"
      >
        <Icone nom="cloche" className="size-5" />
        {nonLues > 0 ? (
          <span
            aria-hidden
            className="absolute right-1.5 top-1.5 flex min-w-[18px] items-center justify-center rounded-full bg-brand-700 px-1 text-[10px] font-semibold leading-[18px] text-white ring-2 ring-white"
          >
            {nonLues > 99 ? "99+" : nonLues}
          </span>
        ) : null}
      </button>

      {ouvert ? (
        <div
          id={idPanneau}
          role="dialog"
          aria-label="Dernières notifications"
          className="absolute z-50 mt-2 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-sand-200 bg-white shadow-[0_12px_40px_-12px_rgba(17,20,18,0.3)] max-lg:right-0 lg:bottom-full lg:left-0 lg:mb-2 lg:mt-0"
        >
          <div className="flex items-center justify-between gap-3 border-b border-sand-200 px-4 py-2.5">
            <p className="text-sm font-semibold text-ink-900">Notifications</p>
            {nonLues > 0 ? (
              <form action={actionToutLu}>
                <button
                  type="submit"
                  disabled={enCours}
                  className="rounded-md px-2 py-1 text-xs font-medium text-brand-700 transition-colors duration-150 hover:bg-brand-50 disabled:opacity-55"
                >
                  Tout marquer lu
                </button>
              </form>
            ) : null}
          </div>

          {recentes.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-slate-500">
              Aucune notification pour le moment.
            </p>
          ) : (
            <ul className="max-h-[60vh] divide-y divide-sand-100 overflow-y-auto">
              {recentes.map((n) => (
                <li key={n.id}>
                  <LigneNotification notification={n} onNavigue={fermer} />
                </li>
              ))}
            </ul>
          )}

          <div className="border-t border-sand-200 px-4 py-2.5">
            <Link
              href="/notifications"
              onClick={fermer}
              className="text-sm font-medium text-brand-700 hover:text-brand-800"
            >
              Toutes les notifications
            </Link>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Une ligne : cliquer marque comme lue puis suit le lien. Le marquage
 * part en action serveur sans bloquer la navigation.
 */
function LigneNotification({
  notification,
  onNavigue,
}: {
  notification: NotificationResume;
  onNavigue: () => void;
}) {
  const [, action] = useActionState<ActionState, FormData>(marquerLue, {});
  const formulaireRef = useRef<HTMLFormElement>(null);
  const nonLue = notification.read_at === null;
  const contenu = (
    <>
      <span
        aria-hidden
        className={`mt-1.5 size-2 shrink-0 rounded-full ${nonLue ? "bg-brand-600" : "bg-transparent"}`}
      />
      <span className="min-w-0 flex-1">
        <span className="block text-[11px] font-medium text-slate-500">
          {libelleType(notification.type)} · {dateRelative(notification.created_at)}
        </span>
        <span
          className={`block text-sm leading-snug ${nonLue ? "font-medium text-ink-900" : "text-slate-700"}`}
        >
          {notification.title}
        </span>
        {notification.body ? (
          <span className="block text-xs leading-relaxed text-slate-500">
            {tronquer(notification.body, 110)}
          </span>
        ) : null}
      </span>
    </>
  );

  const classes =
    "flex w-full gap-3 px-4 py-3 text-left transition-colors duration-150 hover:bg-sand-50";

  if (notification.href) {
    return (
      <form ref={formulaireRef} action={action}>
        <input type="hidden" name="notification_id" value={notification.id} />
        <Link
          href={notification.href}
          onClick={() => {
            if (nonLue) formulaireRef.current?.requestSubmit();
            onNavigue();
          }}
          className={classes}
        >
          {contenu}
        </Link>
      </form>
    );
  }

  return (
    <form action={action}>
      <input type="hidden" name="notification_id" value={notification.id} />
      <button type="submit" disabled={!nonLue} className={classes}>
        {contenu}
      </button>
    </form>
  );
}

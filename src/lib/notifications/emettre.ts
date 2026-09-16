import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import type { TypeNotification } from "@/lib/notifications/notifications";

/**
 * Émission des notifications in-app – côté serveur uniquement.
 *
 * La table `notifications` n'a aucune politique d'insertion pour les
 * utilisateurs : c'est la plateforme qui notifie, jamais un membre vers
 * un autre. L'écriture passe donc par le client d'administration, depuis
 * des actions serveur qui ont déjà vérifié l'identité et les droits de
 * l'appelant.
 *
 * Une émission qui échoue ne doit jamais faire échouer l'action qui
 * l'a déclenchée (un badge reste acquis même si la cloche rate) : les
 * erreurs sont journalisées, pas propagées.
 */

export interface NotificationAEmettre {
  userId: string;
  organizationId?: string | null;
  type: TypeNotification;
  title: string;
  body?: string | null;
  href?: string | null;
}

function loguer(operation: string, erreur: unknown) {
  if (erreur) console.error(`[notifications] ${operation}`, erreur);
}

export async function emettreNotifications(lot: NotificationAEmettre[]): Promise<void> {
  if (lot.length === 0) return;
  try {
    const admin = createAdminClient();
    const { error } = await admin.from("notifications").insert(
      lot.map((n) => ({
        user_id: n.userId,
        organization_id: n.organizationId ?? null,
        type: n.type,
        title: n.title,
        body: n.body ?? null,
        href: n.href ?? null,
      }))
    );
    loguer("émission", error);
  } catch (erreur) {
    loguer("émission (client admin)", erreur);
  }
}

export async function emettreNotification(n: NotificationAEmettre): Promise<void> {
  await emettreNotifications([n]);
}

/**
 * Notifie l'encadrement d'une formation : son concepteur (`owner_id`)
 * et les formateurs affectés (`course_trainers`), dédoublonnés. Une
 * personne exclue (`sauf`) n'est pas notifiée de sa propre action.
 */
export async function notifierEncadrementFormation(
  courseId: string,
  notif: Omit<NotificationAEmettre, "userId" | "organizationId">,
  sauf?: string
): Promise<void> {
  try {
    const admin = createAdminClient();
    const [{ data: course }, { data: formateurs }] = await Promise.all([
      admin.from("courses").select("owner_id, organization_id").eq("id", courseId).maybeSingle(),
      admin.from("course_trainers").select("user_id").eq("course_id", courseId),
    ]);
    if (!course) return;

    const destinataires = new Set<string>();
    if (course.owner_id) destinataires.add(course.owner_id as string);
    for (const f of formateurs ?? []) destinataires.add(f.user_id as string);
    if (sauf) destinataires.delete(sauf);

    await emettreNotifications(
      [...destinataires].map((userId) => ({
        ...notif,
        userId,
        organizationId: course.organization_id as string,
      }))
    );
  } catch (erreur) {
    loguer("encadrement de la formation", erreur);
  }
}

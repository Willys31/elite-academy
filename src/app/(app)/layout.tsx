import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/profile";
import { navigationFor, primaryRole } from "@/lib/auth/roles";
import type { NotificationResume } from "@/lib/notifications/notifications";
import { seDeconnecter } from "@/app/(auth)/actions";
import { AppShell } from "@/components/layout/AppShell";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/connexion");

  const role = primaryRole(user.memberships);
  const nav = navigationFor(role);

  /* La cloche reçoit ses données du serveur (RLS) : les huit dernières
     notifications et le nombre de non lues. Une table absente (migration
     0012 non appliquée) ne doit pas casser le cadre : on retombe sur
     une cloche vide. */
  const supabase = await createClient();
  const [{ data: recentes }, { count: nonLues }] = await Promise.all([
    supabase
      .from("notifications")
      .select("id, type, title, body, href, read_at, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(8),
    supabase
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .is("read_at", null),
  ]);

  return (
    <AppShell
      nav={nav}
      role={role}
      userId={user.id}
      userName={user.fullName || user.email}
      notifications={{
        nonLues: nonLues ?? 0,
        recentes: (recentes ?? []) as NotificationResume[],
      }}
      onSignOut={seDeconnecter}
    >
      {children}
    </AppShell>
  );
}

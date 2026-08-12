import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/profile";
import { navigationFor, primaryRole } from "@/lib/auth/roles";
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

  return (
    <AppShell
      nav={nav}
      role={role}
      userName={user.fullName || user.email}
      onSignOut={seDeconnecter}
    >
      {children}
    </AppShell>
  );
}

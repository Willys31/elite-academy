import { createClient } from "@/lib/supabase/server";
import type { Membership } from "@/lib/auth/roles";

export interface CurrentUser {
  id: string;
  email: string;
  fullName: string;
  memberships: Membership[];
}

/**
 * Récupère l'utilisateur connecté, son profil et ses adhésions.
 * Retourne null si personne n'est connecté.
 * Les données lues sont filtrées par RLS.
 */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const [{ data: profile }, { data: memberships }] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, full_name, email")
      .eq("id", user.id)
      .maybeSingle(),
    supabase
      .from("organization_members")
      .select(
        "organization_id, role, status, organization:organizations(id, name, type)"
      )
      .eq("user_id", user.id),
  ]);

  return {
    id: user.id,
    email: profile?.email ?? user.email ?? "",
    fullName: profile?.full_name ?? "",
    memberships: (memberships ?? []).map((m) => ({
      organization_id: m.organization_id,
      role: m.role,
      status: m.status,
      organization: Array.isArray(m.organization)
        ? (m.organization[0] ?? null)
        : m.organization,
    })) as Membership[],
  };
}

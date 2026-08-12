import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/profile";
import { activeMemberships, isEliteAdmin } from "@/lib/auth/roles";
import { SESSION_STATUS_LABELS } from "@/lib/sessions/sessions";
import { creerSession } from "@/app/(app)/sessions/actions";
import { AuthForm } from "@/components/ui/AuthForm";
import {
  Badge,
  Card,
  EmptyState,
  Input,
  Label,
  PageTitle,
  Select,
} from "@/components/ui";

export const metadata: Metadata = { title: "Sessions" };

export default async function SessionsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/connexion");

  const actives = activeMemberships(user.memberships);
  const elite = isEliteAdmin(user.memberships);
  let orgsAnimation = actives
    .filter((m) => ["admin", "designer", "trainer"].includes(m.role))
    .map((m) => ({ id: m.organization_id, name: m.organization?.name ?? "Organisation" }));

  const supabase = await createClient();
  if (elite) {
    const { data } = await supabase.from("organizations").select("id, name").order("name");
    orgsAnimation = data ?? orgsAnimation;
  }
  const animateur = orgsAnimation.length > 0;

  const [{ data: sessions }, { data: formations }] = await Promise.all([
    supabase
      .from("live_sessions")
      .select(
        "id, title, session_code, status, starts_at, created_at, trainer_id, course:courses(title), organization:organizations(name)"
      )
      .order("created_at", { ascending: false })
      .limit(30),
    animateur
      ? supabase
          .from("courses")
          .select("id, title, organization_id")
          .eq("status", "published")
          .order("title")
      : Promise.resolve({ data: [] }),
  ]);

  return (
    <div>
      <PageTitle>Sessions</PageTitle>

      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <section aria-label="Sessions">
          {!sessions || sessions.length === 0 ? (
            <EmptyState
              title="Aucune session"
              hint={
                animateur
                  ? "Créez votre première session : les participants la rejoindront par code ou QR code."
                  : "Les sessions ouvertes de votre organisation apparaîtront ici. Vous pouvez aussi rejoindre par code."
              }
            />
          ) : (
            <div className="space-y-3">
              {sessions.map((s) => {
                const course = Array.isArray(s.course) ? s.course[0] : s.course;
                const org = Array.isArray(s.organization) ? s.organization[0] : s.organization;
                const estAnimateur = s.trainer_id === user.id || animateur;
                return (
                  <Link
                    key={s.id}
                    href={estAnimateur ? `/sessions/${s.id}` : `/sessions/${s.id}/participer`}
                  >
                    <Card className="transition hover:border-brand-300 hover:shadow">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="font-medium">{s.title}</p>
                        <Badge>{SESSION_STATUS_LABELS[s.status] ?? s.status}</Badge>
                      </div>
                      <p className="mt-1 text-xs text-slate-400">
                        {org?.name}
                        {course?.title ? ` · ${course.title}` : ""}
                        {` · code ${s.session_code}`}
                        {s.starts_at
                          ? ` · ${new Date(s.starts_at).toLocaleString("fr-FR")}`
                          : ""}
                      </p>
                    </Card>
                  </Link>
                );
              })}
            </div>
          )}
          <p className="mt-4 text-sm text-slate-500">
            Participant ?{" "}
            <Link href="/rejoindre" className="text-brand-600 hover:underline">
              Rejoindre une session avec un code
            </Link>
          </p>
        </section>

        {animateur ? (
          <section aria-label="Créer une session">
            <Card>
              <h2 className="mb-3 font-semibold">Nouvelle session</h2>
              <AuthForm
                action={creerSession}
                submitLabel="Créer et ouvrir la session"
                pendingLabel="Création…"
              >
                <div>
                  <Label htmlFor="organization_id">Organisation</Label>
                  <Select id="organization_id" name="organization_id" required>
                    {orgsAnimation.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.name}
                      </option>
                    ))}
                  </Select>
                </div>
                <div>
                  <Label htmlFor="title">Titre</Label>
                  <Input
                    id="title"
                    name="title"
                    required
                    placeholder="Ex. : Atelier gestion des conflits — groupe A"
                  />
                </div>
                <div>
                  <Label htmlFor="course_id">Formation liée (facultatif)</Label>
                  <Select id="course_id" name="course_id" defaultValue="">
                    <option value="">— Aucune —</option>
                    {(formations ?? []).map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.title}
                      </option>
                    ))}
                  </Select>
                  <p className="mt-1 text-xs text-slate-500">
                    Lier une formation publiée permet de lancer ses QCM en direct.
                  </p>
                </div>
                <div>
                  <Label htmlFor="starts_at">Date et heure (facultatif)</Label>
                  <Input id="starts_at" name="starts_at" type="datetime-local" />
                </div>
              </AuthForm>
            </Card>
          </section>
        ) : null}
      </div>
    </div>
  );
}

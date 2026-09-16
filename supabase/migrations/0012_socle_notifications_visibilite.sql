-- ============================================================
-- Elite Academy – Migration 0012
-- Socle transversal des lots 13 à 18 : niveaux de partage
-- (Groupe / Entreprise / Secteur / Public) et notifications in-app.
-- Références : manuel complet §2.4 et §3.8, addenda (sections
-- « Niveaux de partage » et « Notifications »).
--
-- Rappel de conception (leçon 0003) : conditions directes sur la
-- ligne en tête des politiques SELECT.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Niveaux de partage
-- ------------------------------------------------------------

create type public.visibility_scope as enum (
  'group',         -- apprenants inscrits à la même formation
  'organization',  -- tous les membres de l'organisation
  'sector',        -- tous les membres d'une organisation du même secteur
  'public'         -- toute personne connectée à la plateforme
);

-- L'utilisateur est-il membre actif d'une organisation de ce secteur ?
create or replace function public.is_in_sector(sect text)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select sect is not null and exists (
    select 1
    from public.organization_members m
    join public.organizations o on o.id = m.organization_id
    where m.user_id = auth.uid()
      and m.status = 'active'
      and o.sector = sect
  );
$$;

-- Le contenu (organisation émettrice, niveau de partage, formation
-- de rattachement, secteur dénormalisé) est-il visible de l'appelant ?
--
-- Le secteur est passé en paramètre plutôt que lu dans
-- `organizations` : la fonction est appelée depuis des politiques RLS
-- et ne doit pas dépendre d'une table elle-même protégée. Les tables à
-- portée copient donc `organizations.sector` à l'insertion.
create or replace function public.can_see_scope(
  org_id uuid,
  scope  public.visibility_scope,
  cid    uuid,
  sect   text
)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select
    public.is_elite_admin()
    -- L'encadrement de l'organisation émettrice voit tout ce qu'elle publie.
    or public.has_org_role(
         org_id,
         array['admin','designer','trainer','manager']::public.member_role[]
       )
    or case scope
         when 'public'       then auth.uid() is not null
         when 'organization' then public.is_org_member(org_id)
         when 'sector'       then public.is_org_member(org_id) or public.is_in_sector(sect)
         when 'group'        then
           case
             when cid is null then public.is_org_member(org_id)
             else exists (
                    select 1 from public.enrollments e
                    where e.course_id = cid
                      and e.user_id = auth.uid()
                      and e.status in ('active','completed')
                  )
                  or public.oversees_course(cid)
           end
         else false
       end;
$$;

-- ------------------------------------------------------------
-- 2. notifications – messages in-app
-- ------------------------------------------------------------

create table public.notifications (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.profiles (id) on delete cascade,
  organization_id uuid references public.organizations (id) on delete cascade,
  type            text not null,
  title           text not null,
  body            text,
  href            text,
  read_at         timestamptz,
  created_at      timestamptz not null default now()
);

create index idx_notifications_user
  on public.notifications (user_id, created_at desc);

create index idx_notifications_user_unread
  on public.notifications (user_id, created_at desc)
  where read_at is null;

alter table public.notifications enable row level security;

-- Lecture, marquage comme lue et suppression : uniquement les siennes.
create policy notifications_select on public.notifications
  for select using (user_id = auth.uid());

create policy notifications_update on public.notifications
  for update using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy notifications_delete on public.notifications
  for delete using (user_id = auth.uid());

-- Pas de politique d'insertion : une notification est émise par le
-- serveur (client d'administration) au nom de la plateforme, jamais
-- par un utilisateur vers un autre.

-- Temps réel : la cloche se met à jour sans rechargement.
alter publication supabase_realtime add table public.notifications;

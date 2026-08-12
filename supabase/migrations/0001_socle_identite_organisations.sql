-- ============================================================
-- Elite Academy – Migration 0001
-- Socle : profils, organisations, adhésions, marques
-- Sécurité : Row Level Security par organisation et rôle
-- Référence : elite_academy_schema_supabase_final.md (§2, §9, §10)
-- ============================================================

-- ------------------------------------------------------------
-- 0. Types énumérés
-- ------------------------------------------------------------

create type public.org_type as enum (
  'entreprise',
  'ecole',
  'centre_formation',
  'institution',
  'elite_experience'
);

create type public.member_role as enum (
  'admin',      -- administrateur Elite Experience (dans l'org elite_experience)
                -- ou administrateur d'organisation
  'designer',   -- concepteur / expert pédagogique
  'trainer',    -- formateur
  'manager',    -- responsable d'organisation
  'learner'     -- apprenant
);

create type public.record_status as enum (
  'active',
  'inactive',
  'suspended',
  'archived'
);

-- ------------------------------------------------------------
-- 1. profiles – profil applicatif lié à auth.users
-- ------------------------------------------------------------

create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  full_name   text not null default '',
  email       text not null,
  phone       text,
  avatar_url  text,
  status      public.record_status not null default 'active',
  preferences jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ------------------------------------------------------------
-- 2. organizations
-- ------------------------------------------------------------

create table public.organizations (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  type       public.org_type not null default 'entreprise',
  sector     text,
  logo_url   text,
  settings   jsonb not null default '{}'::jsonb,
  status     public.record_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Une seule organisation Elite Experience (siège de la plateforme).
create unique index organizations_single_elite
  on public.organizations (type)
  where type = 'elite_experience';

-- ------------------------------------------------------------
-- 3. organization_members – adhésions et rôles
-- ------------------------------------------------------------

create table public.organization_members (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id         uuid not null references public.profiles (id) on delete cascade,
  role            public.member_role not null default 'learner',
  status          public.record_status not null default 'active',
  joined_at       timestamptz not null default now(),
  unique (organization_id, user_id)
);

-- ------------------------------------------------------------
-- 4. brands – marques rattachées à une organisation
-- ------------------------------------------------------------

create table public.brands (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name            text not null,
  description     text,
  settings        jsonb not null default '{}'::jsonb,
  status          public.record_status not null default 'active',
  created_at      timestamptz not null default now(),
  unique (organization_id, name)
);

-- ------------------------------------------------------------
-- 5. Index
-- ------------------------------------------------------------

create index idx_members_org  on public.organization_members (organization_id);
create index idx_members_user on public.organization_members (user_id);
create index idx_brands_org   on public.brands (organization_id);
create index idx_orgs_status  on public.organizations (status);

-- ------------------------------------------------------------
-- 6. updated_at automatique
-- ------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger trg_profiles_updated
  before update on public.profiles
  for each row execute function public.set_updated_at();

create trigger trg_organizations_updated
  before update on public.organizations
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------
-- 7. Création automatique du profil à l'inscription
-- ------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'full_name', '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger trg_on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ------------------------------------------------------------
-- 8. Fonctions d'aide aux permissions
--    SECURITY DEFINER pour éviter la récursivité RLS
--    sur organization_members.
-- ------------------------------------------------------------

-- L'utilisateur courant est-il membre actif de l'organisation ?
create or replace function public.is_org_member(org_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.organization_members m
    where m.organization_id = org_id
      and m.user_id = auth.uid()
      and m.status = 'active'
  );
$$;

-- L'utilisateur courant a-t-il l'un des rôles donnés dans l'organisation ?
create or replace function public.has_org_role(org_id uuid, roles public.member_role[])
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.organization_members m
    where m.organization_id = org_id
      and m.user_id = auth.uid()
      and m.status = 'active'
      and m.role = any (roles)
  );
$$;

-- L'utilisateur courant est-il administrateur Elite Experience ?
create or replace function public.is_elite_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.organization_members m
    join public.organizations o on o.id = m.organization_id
    where m.user_id = auth.uid()
      and m.status = 'active'
      and m.role = 'admin'
      and o.type = 'elite_experience'
  );
$$;

-- Les deux utilisateurs partagent-ils une organisation active ?
create or replace function public.shares_org_with(other_user uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.organization_members a
    join public.organization_members b
      on a.organization_id = b.organization_id
    where a.user_id = auth.uid()
      and b.user_id = other_user
      and a.status = 'active'
      and b.status = 'active'
  );
$$;

-- ------------------------------------------------------------
-- 9. Row Level Security
-- ------------------------------------------------------------

alter table public.profiles             enable row level security;
alter table public.organizations        enable row level security;
alter table public.organization_members enable row level security;
alter table public.brands               enable row level security;

-- ----- profiles -----

-- Lecture : soi-même, les admins Elite Experience,
-- et les membres d'une organisation commune (nécessaire aux
-- écrans formateur/responsable des lots suivants).
create policy profiles_select on public.profiles
  for select using (
    id = auth.uid()
    or public.is_elite_admin()
    or public.shares_org_with(id)
  );

-- Modification : uniquement son propre profil.
create policy profiles_update_self on public.profiles
  for update using (id = auth.uid())
  with check (id = auth.uid());

-- Pas d'insertion directe : le profil est créé par trigger.
-- Pas de suppression directe : cascade depuis auth.users.

-- ----- organizations -----

-- Lecture : membres de l'organisation ou admin Elite Experience.
create policy organizations_select on public.organizations
  for select using (
    public.is_org_member(id)
    or public.is_elite_admin()
  );

-- Création : uniquement admin Elite Experience.
create policy organizations_insert on public.organizations
  for insert with check (public.is_elite_admin());

-- Modification : admin Elite Experience, ou admin de l'organisation.
create policy organizations_update on public.organizations
  for update using (
    public.is_elite_admin()
    or public.has_org_role(id, array['admin']::public.member_role[])
  );

-- Suppression : uniquement admin Elite Experience.
create policy organizations_delete on public.organizations
  for delete using (public.is_elite_admin());

-- ----- organization_members -----

-- Lecture : ses propres adhésions, les admins Elite Experience,
-- et les responsables/admins/formateurs de l'organisation.
create policy members_select on public.organization_members
  for select using (
    user_id = auth.uid()
    or public.is_elite_admin()
    or public.has_org_role(
         organization_id,
         array['admin','manager','trainer']::public.member_role[]
       )
  );

-- Ajout : admin Elite Experience, ou admin/manager de l'organisation.
create policy members_insert on public.organization_members
  for insert with check (
    public.is_elite_admin()
    or public.has_org_role(
         organization_id,
         array['admin','manager']::public.member_role[]
       )
  );

-- Modification (rôle, statut) : mêmes droits que l'ajout.
create policy members_update on public.organization_members
  for update using (
    public.is_elite_admin()
    or public.has_org_role(
         organization_id,
         array['admin','manager']::public.member_role[]
       )
  );

-- Retrait : mêmes droits que l'ajout.
create policy members_delete on public.organization_members
  for delete using (
    public.is_elite_admin()
    or public.has_org_role(
         organization_id,
         array['admin','manager']::public.member_role[]
       )
  );

-- ----- brands -----

-- Lecture : membres de l'organisation ou admin Elite Experience.
create policy brands_select on public.brands
  for select using (
    public.is_org_member(organization_id)
    or public.is_elite_admin()
  );

-- Gestion : admin Elite Experience ou admin de l'organisation.
create policy brands_insert on public.brands
  for insert with check (
    public.is_elite_admin()
    or public.has_org_role(organization_id, array['admin']::public.member_role[])
  );

create policy brands_update on public.brands
  for update using (
    public.is_elite_admin()
    or public.has_org_role(organization_id, array['admin']::public.member_role[])
  );

create policy brands_delete on public.brands
  for delete using (
    public.is_elite_admin()
    or public.has_org_role(organization_id, array['admin']::public.member_role[])
  );

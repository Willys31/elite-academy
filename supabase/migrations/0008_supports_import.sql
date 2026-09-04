-- ============================================================
-- Elite Academy – Migration 0008
-- Supports de cours et import de documents.
-- Référence : schéma Supabase §8 (sources), architecture §4.3
-- (Storage), document global §13 et §18, PRD §5 et §17.
-- ============================================================

-- ------------------------------------------------------------
-- 0. Nouveau type d'activité : fichier support
--    (PostgreSQL 12+ : autorisé en transaction tant que la valeur
--    n'est pas utilisée dans la même transaction.)
-- ------------------------------------------------------------

alter type public.activity_type add value if not exists 'file';

-- ------------------------------------------------------------
-- 1. sources – documents importés (traçabilité et droits)
-- ------------------------------------------------------------

create table public.sources (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  owner_id        uuid not null references public.profiles (id),
  brand_id        uuid references public.brands (id) on delete set null,
  title           text not null,
  file_path       text not null,
  mime_type       text not null,
  source_type     text not null default 'support_pedagogique',
  confidentiality text not null default 'organisation',
  reuse_rights    text,
  version         integer not null default 1,
  status          public.record_status not null default 'active',
  created_at      timestamptz not null default now()
);

create index idx_sources_org on public.sources (organization_id);
create index idx_sources_owner on public.sources (owner_id);

alter table public.sources enable row level security;

-- Lecture : propriétaire (condition directe, nécessaire au
-- RETURNING), membres de l'organisation, Elite Experience.
create policy sources_select on public.sources
  for select using (
    owner_id = auth.uid()
    or public.is_org_member(organization_id)
    or public.is_elite_admin()
  );

-- Import : admin/concepteur de l'organisation (ou Elite), toujours
-- comme propriétaire.
create policy sources_insert on public.sources
  for insert with check (
    owner_id = auth.uid()
    and (
      public.is_elite_admin()
      or public.has_org_role(organization_id, array['admin','designer']::public.member_role[])
    )
  );

-- Modification / archivage : mêmes rôles.
create policy sources_update on public.sources
  for update using (
    public.is_elite_admin()
    or public.has_org_role(organization_id, array['admin','designer']::public.member_role[])
  );

create policy sources_delete on public.sources
  for delete using (
    public.is_elite_admin()
    or public.has_org_role(organization_id, array['admin','designer']::public.member_role[])
  );

-- ------------------------------------------------------------
-- 2. Bucket de stockage privé « supports »
--    Chemin des fichiers : org/<organization_id>/...
-- ------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'supports',
  'supports',
  false,
  20971520, -- 20 Mo par fichier
  array[
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/plain',
    'text/markdown',
    'image/png',
    'image/jpeg',
    'image/webp',
    'video/mp4',
    'audio/mpeg'
  ]
)
on conflict (id) do nothing;

-- Le deuxième segment du chemin (org/<uuid>/...) porte l'organisation.
create or replace function public.storage_org_id(object_name text)
returns uuid
language sql
immutable
as $$
  select nullif(split_part(object_name, '/', 2), '')::uuid;
$$;

-- Lecture : membres de l'organisation du fichier, Elite Experience.
create policy supports_storage_select on storage.objects
  for select using (
    bucket_id = 'supports'
    and (
      public.is_elite_admin()
      or public.is_org_member(public.storage_org_id(name))
    )
  );

-- Écriture : admin/concepteur de l'organisation, Elite Experience.
create policy supports_storage_insert on storage.objects
  for insert with check (
    bucket_id = 'supports'
    and (
      public.is_elite_admin()
      or public.has_org_role(
           public.storage_org_id(name),
           array['admin','designer']::public.member_role[]
         )
    )
  );

-- Suppression : mêmes rôles (retrait d'un support).
create policy supports_storage_delete on storage.objects
  for delete using (
    bucket_id = 'supports'
    and (
      public.is_elite_admin()
      or public.has_org_role(
           public.storage_org_id(name),
           array['admin','designer']::public.member_role[]
         )
    )
  );

-- Bouchon minimal reproduisant ce que Supabase fournit d'office, pour
-- pouvoir rejouer les migrations dans un Postgres nu et TESTER les
-- politiques RLS. Rien de ceci ne part en production.

create extension if not exists pgcrypto;

create schema if not exists auth;
create schema if not exists storage;

create table auth.users (
  id    uuid primary key default gen_random_uuid(),
  email text
);

-- L'identité de l'appelant est portée par un réglage de session, comme
-- le fait Supabase avec le JWT. `set local request.user = '<uuid>'`
-- remplace ici le jeton.
create or replace function auth.uid() returns uuid
language sql stable as $$
  select nullif(current_setting('request.user', true), '')::uuid;
$$;

create table storage.buckets (
  id     text primary key,
  name   text,
  public boolean default false
);

create table storage.objects (
  id         uuid primary key default gen_random_uuid(),
  bucket_id  text references storage.buckets (id),
  name       text,
  owner      uuid,
  created_at timestamptz default now(),
  metadata   jsonb
);

-- Rôle applicatif : c'est sous ce rôle (non superutilisateur, sans
-- BYPASSRLS) que les tests s'exécutent. Le rôle `postgres` contourne
-- la RLS, il ne prouverait rien.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
end $$;

grant usage on schema public, auth, storage to authenticated;
alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated;

-- Compléments repérés en rejouant les migrations : Supabase fournit
-- aussi une publication temps réel, les rôles anon/service_role, et
-- des colonnes de quota sur les buckets de stockage.
create publication supabase_realtime;

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin;
  end if;
end $$;

grant usage on schema public, auth, storage to anon, service_role;

alter table storage.buckets
  add column if not exists file_size_limit   bigint,
  add column if not exists allowed_mime_types text[];

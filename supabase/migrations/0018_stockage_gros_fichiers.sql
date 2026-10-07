-- ============================================================
-- Elite Academy – Migration 0018
-- Stockage de gros fichiers (jusqu'à 5 Go) : téléversement direct
-- navigateur → Storage (protocole TUS), taille et statut des sources,
-- quota de stockage par organisation, fournisseur de diffusion
-- (Supabase aujourd'hui, Cloudflare Stream plus tard).
-- Dépend de 0008 (sources, bucket « supports »).
--
-- Pourquoi : jusqu'ici le fichier transitait par le serveur Next.js,
-- chargé entièrement en mémoire, et trois plafonds le limitaient à
-- 20 Mo. Les vidéos de cours et les gros documents imposent que les
-- octets aillent directement du navigateur au stockage ; le serveur
-- ne manipule plus que des identifiants.
--
-- ATTENTION – réglage manuel du projet : le « Global file size limit »
-- (Dashboard → Project Settings → Storage) doit aussi être porté à
-- 5 Go. Le plus petit des deux plafonds (projet, bucket) s'applique ;
-- sur le plan Pro, le projet autorise jusqu'à 50 Go.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Bucket « supports » : 5 Go par fichier, formats vidéo/audio
--    élargis (.mov et .m4a sortent d'iPhone et de Mac ; .webm des
--    enregistrements d'écran). MKV et ZIP restent exclus : ils ne se
--    lisent pas dans une page web.
-- ------------------------------------------------------------

update storage.buckets
   set file_size_limit = 5368709120, -- 5 Gio
       allowed_mime_types = array[
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
         'video/webm',
         'video/quicktime',
         'audio/mpeg',
         'audio/mp4'
       ]
 where id = 'supports';

-- ------------------------------------------------------------
-- 2. Mise à jour d'objets : mêmes rôles que l'insertion.
--    Un téléversement TUS repris après coupure peut retrouver une ligne
--    d'objet déjà créée ; sans politique UPDATE, la reprise échouerait
--    sur « violates row-level security ». Aucun écrasement possible
--    pour autant : chaque chemin porte un UUID et x-upsert reste à
--    false côté client.
-- ------------------------------------------------------------

drop policy if exists supports_storage_update on storage.objects;
create policy supports_storage_update on storage.objects
  for update using (
    bucket_id = 'supports'
    and (
      public.is_elite_admin()
      or public.has_org_role(
           public.storage_org_id(name),
           array['admin','designer']::public.member_role[]
         )
    )
  )
  with check (
    bucket_id = 'supports'
    and (
      public.is_elite_admin()
      or public.has_org_role(
           public.storage_org_id(name),
           array['admin','designer']::public.member_role[]
         )
    )
  );

-- ------------------------------------------------------------
-- 3. sources : taille, statut de téléversement, fournisseur.
--    Les lignes existantes sont des fichiers déjà en place : « ready ».
-- ------------------------------------------------------------

alter table public.sources
  add column if not exists size_bytes bigint
    check (size_bytes is null or size_bytes >= 0),
  add column if not exists upload_status text not null default 'ready'
    check (upload_status in ('pending','ready','failed')),
  add column if not exists uploaded_at timestamptz,
  add column if not exists storage_provider text not null default 'supabase'
    check (storage_provider in ('supabase','cloudflare_stream')),
  -- Identifiant chez le fournisseur externe (uid Cloudflare Stream).
  add column if not exists provider_ref text,
  add column if not exists duration_seconds integer
    check (duration_seconds is null or duration_seconds >= 0);

create index if not exists idx_sources_org_upload
  on public.sources (organization_id, upload_status, created_at);

-- ------------------------------------------------------------
-- 4. Quota de stockage par organisation : 20 Go par défaut.
--    Le plan Pro inclut 100 Go ; l'administrateur Elite relève une
--    organisation par un simple update.
-- ------------------------------------------------------------

alter table public.organizations
  add column if not exists storage_quota_bytes bigint not null default 21474836480
    check (storage_quota_bytes >= 0);

-- ------------------------------------------------------------
-- 5. Usage : fichiers prêts + téléversements en cours de moins de
--    24 h (sinon une rafale de lignes « pending » contournerait le
--    quota). La fonction interne sert au déclencheur ; la fonction
--    exposée vérifie l'appartenance.
-- ------------------------------------------------------------

create or replace function public.storage_usage_bytes(org_id uuid)
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(s.size_bytes), 0)::bigint
    from public.sources s
   where s.organization_id = org_id
     and s.status = 'active'
     and (
       s.upload_status = 'ready'
       or (s.upload_status = 'pending' and s.created_at > now() - interval '24 hours')
     );
$$;

revoke all on function public.storage_usage_bytes(uuid) from public;

create or replace function public.organization_storage_usage(org_id uuid)
returns bigint
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not (public.is_elite_admin() or public.is_org_member(org_id)) then
    raise exception 'Accès refusé à l''organisation %', org_id using errcode = '42501';
  end if;
  return public.storage_usage_bytes(org_id);
end;
$$;

revoke all on function public.organization_storage_usage(uuid) from public;
grant execute on function public.organization_storage_usage(uuid) to authenticated;

-- ------------------------------------------------------------
-- 6. Garde-fou en base (leçon du lot 11 : une règle qui n'existe
--    qu'en TypeScript n'existe pas). Le déclencheur rejoue à la
--    finalisation avec la taille réelle constatée dans Storage.
-- ------------------------------------------------------------

create or replace function public.sources_verifier_quota()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  usage_autres bigint;
  quota bigint;
begin
  if new.size_bytes is null or new.upload_status = 'failed' then
    return new;
  end if;

  select o.storage_quota_bytes into quota
    from public.organizations o
   where o.id = new.organization_id;

  -- Usage de l'organisation sans la ligne en cours de modification.
  usage_autres := public.storage_usage_bytes(new.organization_id)
    - coalesce((
        select s.size_bytes
          from public.sources s
         where s.id = new.id
           and s.status = 'active'
           and (
             s.upload_status = 'ready'
             or (s.upload_status = 'pending' and s.created_at > now() - interval '24 hours')
           )
      ), 0);

  if usage_autres + new.size_bytes > coalesce(quota, 0) then
    raise exception 'quota_stockage_depasse'
      using errcode = 'P0001',
            detail = format('%s + %s > %s', usage_autres, new.size_bytes, quota);
  end if;

  return new;
end;
$$;

drop trigger if exists sources_quota on public.sources;
create trigger sources_quota
  before insert or update of size_bytes, upload_status, organization_id
  on public.sources
  for each row execute function public.sources_verifier_quota();

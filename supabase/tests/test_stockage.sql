\pset tuples_only on
\pset border 0

-- Lot 20 : quota de stockage et politique UPDATE du bucket « supports ».
-- Pré-requis : shim_local.sql, migrations 0001 → 0018, jeu_essai.sql,
-- fonctions_essai_generique.sql. L'organisation du jeu d'essai est
-- lue dynamiquement : son identifiant n'est pas figé ici.

set role authenticated;

-- Quota de l'organisation d'essai ramené à 2 Go pour le test.
reset role;
update public.organizations set storage_quota_bytes = 2 * 1024::bigint ^ 3
 where id = (select organization_id from public.organization_members
              where user_id = '22222222-2222-2222-2222-222222222222' limit 1);
set role authenticated;

-- 1. Le concepteur réserve 1 Go : autorisé.
select public.essai(
  '22222222-2222-2222-2222-222222222222',
  $$insert into public.sources (organization_id, owner_id, title, file_path, mime_type, size_bytes, upload_status)
    select organization_id, '22222222-2222-2222-2222-222222222222', 'video-1.mp4',
           'org/' || organization_id || '/courses/x/uuid-1-video-1.mp4', 'video/mp4',
           1024::bigint ^ 3, 'pending'
      from public.organization_members where user_id = '22222222-2222-2222-2222-222222222222' limit 1$$,
  'concepteur réserve 1 Go dans un quota de 2 Go'
);

-- 2. Le concepteur réserve 1,5 Go de plus : refusé (P0001 quota_stockage_depasse).
select public.essai(
  '22222222-2222-2222-2222-222222222222',
  $$insert into public.sources (organization_id, owner_id, title, file_path, mime_type, size_bytes, upload_status)
    select organization_id, '22222222-2222-2222-2222-222222222222', 'video-2.mp4',
           'org/' || organization_id || '/courses/x/uuid-2-video-2.mp4', 'video/mp4',
           (1.5 * 1024 ^ 3)::bigint, 'pending'
      from public.organization_members where user_id = '22222222-2222-2222-2222-222222222222' limit 1$$,
  'concepteur dépasse le quota (attendu : refusé P0001)'
);

-- 3. L'apprenant lit l'usage de son organisation : autorisé (membre).
select public.essai(
  '55555555-5555-5555-5555-555555555555',
  $$select public.organization_storage_usage(
      (select organization_id from public.organization_members
        where user_id = '55555555-5555-5555-5555-555555555555' limit 1))$$,
  'apprenant lit l''usage de son organisation'
);

-- 4. Le formateur d'une autre organisation lit l'usage : refusé (42501).
select public.essai(
  '66666666-6666-6666-6666-666666666666',
  $$select public.organization_storage_usage(
      (select organization_id from public.organization_members
        where user_id = '22222222-2222-2222-2222-222222222222' limit 1))$$,
  'étranger lit l''usage (attendu : refusé 42501)'
);

-- 5. Politique UPDATE du bucket : l'apprenant ne touche aucun objet,
--    le concepteur peut mettre à jour un objet de son organisation.
reset role;
insert into storage.objects (bucket_id, name, metadata)
select 'supports', 'org/' || organization_id || '/courses/x/uuid-3-test.mp4', '{}'::jsonb
  from public.organization_members where user_id = '22222222-2222-2222-2222-222222222222' limit 1;
set role authenticated;

select public.essai(
  '55555555-5555-5555-5555-555555555555',
  $$update storage.objects set metadata = '{"test":1}'::jsonb where name like 'org/%/courses/x/uuid-3-test.mp4'$$,
  'apprenant met à jour un objet (attendu : refusé 0 ligne)'
);

select public.essai(
  '22222222-2222-2222-2222-222222222222',
  $$update storage.objects set metadata = '{"test":1}'::jsonb where name like 'org/%/courses/x/uuid-3-test.mp4'$$,
  'concepteur met à jour un objet de son organisation'
);

reset role;

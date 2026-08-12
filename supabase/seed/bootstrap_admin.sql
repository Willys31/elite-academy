-- ============================================================
-- Elite Academy – Amorçage du premier administrateur
-- ============================================================
-- À exécuter UNE FOIS dans l'éditeur SQL de Supabase,
-- APRÈS avoir appliqué la migration 0001 et créé votre compte
-- via l'écran d'inscription de l'application.
--
-- 1. Remplacer l'adresse e-mail ci-dessous par la vôtre.
-- 2. Exécuter le script.
-- ============================================================

do $$
declare
  v_email text := 'admin@elite-experience.example';  -- <-- À REMPLACER
  v_user  uuid;
  v_org   uuid;
begin
  -- Retrouver l'utilisateur inscrit
  select id into v_user from auth.users where email = v_email;
  if v_user is null then
    raise exception 'Aucun utilisateur avec l''e-mail %. Créez d''abord le compte via l''application.', v_email;
  end if;

  -- Créer (ou retrouver) l'organisation Elite Experience
  select id into v_org
  from public.organizations
  where type = 'elite_experience';

  if v_org is null then
    insert into public.organizations (name, type, sector, status)
    values ('Elite Experience', 'elite_experience', 'formation', 'active')
    returning id into v_org;
  end if;

  -- Donner le rôle admin
  insert into public.organization_members (organization_id, user_id, role, status)
  values (v_org, v_user, 'admin', 'active')
  on conflict (organization_id, user_id)
  do update set role = 'admin', status = 'active';

  raise notice 'Administrateur Elite Experience configuré pour %', v_email;
end $$;

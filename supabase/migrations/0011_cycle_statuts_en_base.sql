-- ============================================================
-- Elite Academy – Migration 0011
-- Le cycle de validation devient une règle de la BASE, plus
-- seulement une règle de l'interface.
--
-- FAILLE CORRIGÉE (constatée en rejouant les migrations dans un
-- PostgreSQL local, le 2026-09-15) :
--
--   Les transitions de statut n'existaient que dans TypeScript
--   (`canTransition`, src/lib/courses/statuts.ts). En base, la
--   politique `courses_update` autorise le propriétaire à modifier
--   SA formation — toutes colonnes confondues, `status` inclus. Un
--   concepteur, et depuis la migration 0010 un formateur, pouvait
--   donc publier sa propre formation d'un simple appel à l'API :
--
--     update courses set status = 'published' where id = '…';
--
--   Même chose à la création : rien n'obligeait `status` à valoir
--   'draft', on pouvait insérer directement une formation publiée.
--
--   La règle « aucun contenu ne se publie sans validation humaine »
--   (document global §19, PRD §22) n'était donc pas tenue par la
--   base. Le document global la présente comme « une règle de la
--   plateforme, pas une option » : elle doit vivre là où personne
--   ne peut la contourner.
--
-- Cette faille précède la migration 0010 — un concepteur en
-- disposait déjà. La 0010 n'a fait qu'élargir le nombre de
-- personnes concernées, ce qui la rend plus urgente à fermer.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Toute formation naît en brouillon
--
--    Contrainte plutôt que valeur par défaut : une valeur par
--    défaut se contourne en la précisant explicitement.
-- ------------------------------------------------------------

create or replace function public.forcer_brouillon_a_la_creation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status is distinct from 'draft'::public.course_status then
    raise exception
      'Une formation est toujours créée en brouillon : elle ne peut pas être insérée avec le statut %.',
      new.status
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger trg_courses_naissance_brouillon
  before insert on public.courses
  for each row execute function public.forcer_brouillon_a_la_creation();

-- ------------------------------------------------------------
-- 2. Les transitions autorisées, et par qui
--
--    Ce tableau est le jumeau de `TRANSITIONS` dans
--    src/lib/courses/statuts.ts. Les deux doivent rester
--    identiques : le TypeScript décide quels boutons s'affichent,
--    celui-ci décide de ce qui se produit réellement. En cas de
--    divergence, c'est celui-ci qui fait foi.
-- ------------------------------------------------------------

create or replace function public.verifier_transition_statut()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  autorises public.member_role[];
  passage   text;
begin
  -- Une mise à jour qui ne touche pas au statut n'est pas concernée.
  if new.status is not distinct from old.status then
    return new;
  end if;

  passage := old.status::text || '->' || new.status::text;

  autorises := case passage
    when 'draft->review'       then array['admin','designer','trainer']
    when 'review->approved'    then array['admin']
    when 'review->draft'       then array['admin']
    when 'approved->published' then array['admin']
    when 'approved->draft'     then array['admin','designer']
    when 'published->archived' then array['admin']
    when 'draft->archived'     then array['admin']
    when 'archived->draft'     then array['admin']
    else null
  end::public.member_role[];

  if autorises is null then
    raise exception
      'Transition de statut inexistante : % vers %. Le cycle est brouillon → validation → approuvé → publié.',
      old.status, new.status
      using errcode = 'check_violation';
  end if;

  -- L'administrateur Elite Experience passe partout, comme partout
  -- ailleurs dans le schéma.
  if public.is_elite_admin() then
    return new;
  end if;

  if not public.has_org_role(new.organization_id, autorises) then
    raise exception
      'Votre rôle ne permet pas de faire passer cette formation de % à %.',
      old.status, new.status
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end;
$$;

-- `before update of status` : le déclencheur ne se réveille que si la
-- colonne figure dans l'UPDATE, les modifications de contenu ne
-- paient donc rien.
create trigger trg_courses_transition_statut
  before update of status on public.courses
  for each row execute function public.verifier_transition_statut();

comment on function public.verifier_transition_statut() is
  'Applique en base le cycle de validation des formations. Jumeau de TRANSITIONS dans src/lib/courses/statuts.ts — en cas de divergence, cette fonction fait foi.';

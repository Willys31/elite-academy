-- ============================================================
-- Elite Academy – Migration 0019
-- Les PREUVES d'apprentissage (tentatives, maîtrise, complétion)
-- et les CORRIGÉS ne sont plus accessibles en écriture ou en
-- lecture à l'apprenant par appel direct à l'API.
--
-- FAILLES CONSTATÉES le 15 octobre 2026 en interrogeant l'API
-- REST avec le jeton d'un compte apprenant (sondes rejouables :
-- supabase/tests/test_preuves.sql) :
--
--   1. `select expected_answer, explanation from questions`
--      renvoyait les corrigés de tous les QCM visibles — AVANT
--      toute tentative. La politique `questions_select` (0005)
--      porte sur la ligne entière ; les pages ne lisaient pas ces
--      colonnes avant soumission, mais rien n'empêchait un appel
--      direct. (Point déjà signalé « hors périmètre » au lot 18.)
--   2. `update enrollments set status = 'completed'` sur sa propre
--      inscription passait : `enrollments_update` autorise
--      l'apprenant sans restreindre les colonnes. L'attestation de
--      complétion (`certs_insert`) ne vérifie QUE ce statut : elle
--      devenait réclamable sans avoir ouvert une leçon. (Signalé au
--      lot 12 §6.) De même, `enrollments_insert` acceptait une
--      inscription directement `completed`.
--   3. `insert into progress_records (…, mastery_level = 'elite')`
--      passait : l'apprenant écrivait lui-même son niveau de
--      maîtrise — y compris Elite, que le document global §19
--      réserve à une validation humaine — et marquait n'importe
--      quelle leçon terminée.
--   4. `insert into attempts (…, score = 100)` passait sans
--      correction serveur : un faux score alimentait la maîtrise,
--      le classement, les résultats vus par le formateur.
--
-- Règle retenue, la même qu'aux lots 13 à 18 pour les tables « à
-- valeur » (xp_events, learner_badges…) : ces tables sont
-- ALIMENTÉES PAR LA PLATEFORME (client d'administration, depuis
-- une action serveur qui a vérifié identité, droits et calculé le
-- résultat), jamais par l'utilisateur. Les lectures restent sous
-- RLS, inchangées.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Corrigés : `expected_answer` et `explanation` ne sont plus
--    lisibles par les rôles applicatifs.
--
--    Un privilège de colonne ne restreint rien tant que le
--    privilège de TABLE existe (grant par défaut de Supabase) : on
--    retire donc SELECT sur la table, puis on le rend colonne par
--    colonne. Toute colonne ajoutée plus tard à `questions` devra
--    être ajoutée ici. INSERT, UPDATE et DELETE restent entiers
--    (éditeur de QCM, sous `questions_write`).
--
--    Lecture des corrigés : client d'administration uniquement —
--    correction d'une tentative (`soumettreQcm`), éditeur de QCM
--    du concepteur (après `can_edit_activity`), explication
--    détaillée du tuteur (après une tentative).
-- ------------------------------------------------------------

revoke select on public.questions from anon, authenticated;

grant select (id, activity_id, type, prompt, options, difficulty, competency_id, position, created_at)
  on public.questions to authenticated;

-- ------------------------------------------------------------
-- 2. Tentatives : plus d'insertion par l'utilisateur.
-- ------------------------------------------------------------

drop policy if exists attempts_insert on public.attempts;

-- ------------------------------------------------------------
-- 3. Progression et maîtrise : plus d'écriture par l'utilisateur.
-- ------------------------------------------------------------

drop policy if exists progress_insert on public.progress_records;
drop policy if exists progress_update on public.progress_records;

-- ------------------------------------------------------------
-- 4. Inscriptions : l'apprenant ne peut que s'inscrire, se retirer
--    et se réinscrire. `completed` est posé par la plateforme
--    quand toutes les leçons sont terminées ; `suspended` et
--    `assigned_by` relèvent de l'encadrement.
--
--    Déclencheur plutôt que politique : une politique RLS ne sait
--    pas comparer OLD et NEW. Le client d'administration et
--    l'encadrement (admin / responsable de l'organisation, Elite
--    Experience) ne sont pas concernés.
-- ------------------------------------------------------------

create or replace function public.verifier_inscription_apprenant()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  appelant uuid := auth.uid();
begin
  -- Client d'administration (pas de JWT utilisateur) : libre.
  if appelant is null then
    return new;
  end if;

  -- Encadrement : libre (attribution, suspension, complétion manuelle).
  if public.is_elite_admin()
     or public.has_org_role(new.organization_id, array['admin','manager']::public.member_role[]) then
    return new;
  end if;

  -- À partir d'ici, l'appelant agit sur sa propre inscription.
  if new.user_id is distinct from appelant then
    raise exception 'Vous ne pouvez modifier que votre propre inscription.'
      using errcode = 'insufficient_privilege';
  end if;

  if tg_op = 'INSERT' then
    if new.status is distinct from 'active'::public.enrollment_status
       or new.completed_at is not null
       or new.assigned_by is not null then
      raise exception
        'Une inscription se crée toujours au statut « active » : la complétion est constatée par la plateforme.'
        using errcode = 'check_violation';
    end if;
    return new;
  end if;

  -- UPDATE : seules les transitions active ↔ withdrawn, sans toucher
  -- au reste.
  if new.course_id is distinct from old.course_id
     or new.user_id is distinct from old.user_id
     or new.organization_id is distinct from old.organization_id
     or new.assigned_by is distinct from old.assigned_by
     or new.completed_at is distinct from old.completed_at
     or new.created_at is distinct from old.created_at then
    raise exception 'Seul le statut de votre inscription peut être modifié.'
      using errcode = 'insufficient_privilege';
  end if;

  if new.status is distinct from old.status
     and not (
       (old.status = 'active'    and new.status = 'withdrawn')
       or (old.status = 'withdrawn' and new.status = 'active')
     ) then
    raise exception
      'Transition d''inscription non autorisée : % vers %. Un apprenant peut seulement se retirer d''une formation en cours ou s''y réinscrire.',
      old.status, new.status
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_enrollments_apprenant on public.enrollments;
create trigger trg_enrollments_apprenant
  before insert or update on public.enrollments
  for each row execute function public.verifier_inscription_apprenant();

comment on function public.verifier_inscription_apprenant() is
  'Un apprenant ne peut que créer (active), retirer et réactiver sa propre inscription. La complétion est posée par la plateforme (client d''administration) ; suspension et attribution par l''encadrement.';

\pset tuples_only on
\pset border 0

-- Migration 0019 : corrigés et preuves hors de portée de l'apprenant.
-- Pré-requis : shim_local.sql, migrations 0001 → 0019, jeu_essai.sql,
-- fonctions_essai_generique.sql.
--
-- Les quatre sondes ci-dessous reproduisent ce qui a été constaté le
-- 15 octobre 2026 sur l'API REST avec le jeton d'un compte apprenant.
-- AVANT la migration 0019, chacune répondait AUTORISÉ.

-- Jeu : une formation publiée, une leçon, un QCM, une question, et
-- l'apprenant inscrit. Tout est posé hors RLS (reset role), comme le
-- ferait l'application via le client d'administration.
reset role;
insert into public.courses (id, organization_id, owner_id, title, slug, status)
select 'cccccccc-0000-0000-0000-000000000001', organization_id, '22222222-2222-2222-2222-222222222222',
       'Formation preuves', 'formation-preuves', 'draft'
  from public.organization_members where user_id = '22222222-2222-2222-2222-222222222222' limit 1
on conflict (id) do nothing;
insert into public.course_versions (id, course_id, version_number, created_by)
values ('cccccccc-0000-0000-0000-000000000002', 'cccccccc-0000-0000-0000-000000000001', 1, '22222222-2222-2222-2222-222222222222')
on conflict (id) do nothing;
update public.courses set current_version_id = 'cccccccc-0000-0000-0000-000000000002'
 where id = 'cccccccc-0000-0000-0000-000000000001';
insert into public.modules (id, course_version_id, title)
values ('cccccccc-0000-0000-0000-000000000003', 'cccccccc-0000-0000-0000-000000000002', 'Module')
on conflict (id) do nothing;
insert into public.lessons (id, module_id, title)
values ('cccccccc-0000-0000-0000-000000000004', 'cccccccc-0000-0000-0000-000000000003', 'Leçon')
on conflict (id) do nothing;
insert into public.activities (id, lesson_id, type, title)
values ('cccccccc-0000-0000-0000-000000000005', 'cccccccc-0000-0000-0000-000000000004', 'quiz', 'QCM')
on conflict (id) do nothing;
insert into public.questions (id, activity_id, prompt, options, expected_answer, explanation)
values ('cccccccc-0000-0000-0000-000000000006', 'cccccccc-0000-0000-0000-000000000005', 'Q ?',
        '["a","b"]'::jsonb, '{"index": 1}'::jsonb, 'Parce que.')
on conflict (id) do nothing;
-- Publication directe : le déclencheur de transition (0011) exige un
-- rôle ; on passe par les transitions sous l'identité de l'admin.
set role authenticated;
select public.essai('11111111-1111-1111-1111-111111111111',
  $$update public.courses set status = 'review' where id = 'cccccccc-0000-0000-0000-000000000001'$$, 'jeu : soumission');
select public.essai('11111111-1111-1111-1111-111111111111',
  $$update public.courses set status = 'approved' where id = 'cccccccc-0000-0000-0000-000000000001'$$, 'jeu : approbation');
select public.essai('11111111-1111-1111-1111-111111111111',
  $$update public.courses set status = 'published' where id = 'cccccccc-0000-0000-0000-000000000001'$$, 'jeu : publication');

-- 0. L'apprenant s'inscrit : autorisé (statut active imposé).
select public.essai('55555555-5555-5555-5555-555555555555',
  $$insert into public.enrollments (course_id, user_id, organization_id, status)
    select 'cccccccc-0000-0000-0000-000000000001', '55555555-5555-5555-5555-555555555555', organization_id, 'active'
      from public.organization_members where user_id = '55555555-5555-5555-5555-555555555555' limit 1$$,
  'apprenant s''inscrit (attendu : AUTORISÉ)');

-- 1. Lire le corrigé : refusé (42501, privilège de colonne).
select public.essai('55555555-5555-5555-5555-555555555555',
  $$select expected_answer, explanation from public.questions where activity_id = 'cccccccc-0000-0000-0000-000000000005'$$,
  'apprenant lit expected_answer (attendu : refusé 42501)');

-- 1b. Lire l''énoncé reste possible.
select public.essai('55555555-5555-5555-5555-555555555555',
  $$select id, prompt, options from public.questions where activity_id = 'cccccccc-0000-0000-0000-000000000005'$$,
  'apprenant lit l''énoncé (attendu : AUTORISÉ)');

-- 2. Se déclarer « terminé » : refusé (déclencheur 0019).
select public.essai('55555555-5555-5555-5555-555555555555',
  $$update public.enrollments set status = 'completed', completed_at = now()
     where course_id = 'cccccccc-0000-0000-0000-000000000001' and user_id = '55555555-5555-5555-5555-555555555555'$$,
  'apprenant passe son inscription à completed (attendu : refusé)');

-- 2b. Se retirer puis se réinscrire : autorisé.
select public.essai('55555555-5555-5555-5555-555555555555',
  $$update public.enrollments set status = 'withdrawn'
     where course_id = 'cccccccc-0000-0000-0000-000000000001' and user_id = '55555555-5555-5555-5555-555555555555'$$,
  'apprenant se retire (attendu : AUTORISÉ)');
select public.essai('55555555-5555-5555-5555-555555555555',
  $$update public.enrollments set status = 'active'
     where course_id = 'cccccccc-0000-0000-0000-000000000001' and user_id = '55555555-5555-5555-5555-555555555555'$$,
  'apprenant se réinscrit (attendu : AUTORISÉ)');

-- 2c. S''inscrire directement « terminé » à une autre formation : refusé.
select public.essai('55555555-5555-5555-5555-555555555555',
  $$insert into public.enrollments (course_id, user_id, organization_id, status, completed_at)
    select 'cccccccc-0000-0000-0000-000000000001', '66666666-6666-6666-6666-666666666666', organization_id, 'completed', now()
      from public.organization_members where user_id = '55555555-5555-5555-5555-555555555555' limit 1$$,
  'apprenant insère une inscription pour autrui (attendu : refusé)');

-- 3. Écrire sa maîtrise : refusé (plus de politique d''insertion).
select public.essai('55555555-5555-5555-5555-555555555555',
  $$insert into public.progress_records (user_id, course_id, competency_id, mastery_level, score)
    select '55555555-5555-5555-5555-555555555555', 'cccccccc-0000-0000-0000-000000000001', id, 'elite', 100
      from public.competencies limit 1$$,
  'apprenant s''attribue le niveau Elite (attendu : refusé)');

-- 4. Écrire une tentative : refusé (plus de politique d''insertion).
select public.essai('55555555-5555-5555-5555-555555555555',
  $$insert into public.attempts (activity_id, user_id, answers, score, status, submitted_at)
    values ('cccccccc-0000-0000-0000-000000000005', '55555555-5555-5555-5555-555555555555', '{}'::jsonb, 100, 'graded', now())$$,
  'apprenant insère une tentative à 100 % (attendu : refusé)');

-- 5. La plateforme (sans JWT, comme le client d''administration) écrit
--    la tentative, la maîtrise et la complétion : autorisé.
reset role;
insert into public.attempts (activity_id, user_id, answers, score, status, submitted_at)
values ('cccccccc-0000-0000-0000-000000000005', '55555555-5555-5555-5555-555555555555', '{}'::jsonb, 100, 'graded', now());
insert into public.progress_records (user_id, course_id, competency_id, mastery_level, score)
select '55555555-5555-5555-5555-555555555555', 'cccccccc-0000-0000-0000-000000000001', id, 'fundamentals', 100
  from public.competencies limit 1;
update public.enrollments set status = 'completed', completed_at = now()
 where course_id = 'cccccccc-0000-0000-0000-000000000001' and user_id = '55555555-5555-5555-5555-555555555555';
select 'plateforme écrit tentative, maîtrise, complétion : AUTORISÉ';

-- 6. L''apprenant lit toujours ses preuves.
set role authenticated;
select public.essai('55555555-5555-5555-5555-555555555555',
  $$select id from public.attempts where user_id = '55555555-5555-5555-5555-555555555555'$$,
  'apprenant lit ses tentatives (attendu : AUTORISÉ)');
select public.essai('55555555-5555-5555-5555-555555555555',
  $$select id from public.progress_records where user_id = '55555555-5555-5555-5555-555555555555'$$,
  'apprenant lit sa progression (attendu : AUTORISÉ)');

-- 7. L''encadrement conserve ses droits sur les inscriptions.
select public.essai('44444444-4444-4444-4444-444444444444',
  $$update public.enrollments set status = 'suspended'
     where course_id = 'cccccccc-0000-0000-0000-000000000001' and user_id = '55555555-5555-5555-5555-555555555555'$$,
  'responsable suspend une inscription (attendu : AUTORISÉ)');
reset role;

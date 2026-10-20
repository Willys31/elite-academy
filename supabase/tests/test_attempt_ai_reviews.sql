\pset tuples_only on
\pset border 0

-- Migration 0021 (lot 26) : la proposition de correction de l'IA est
-- réservée à l'encadrement. Pré-requis : shim_local.sql, migrations
-- 0001 → 0021, jeu_essai.sql, fonctions_essai_generique.sql, et le jeu
-- de test_preuves.sql (formation cccccccc-…0001 publiée, QCM …0005,
-- apprenant 5555… inscrit).
--
-- Rôles du jeu d'essai : 1111… admin, 2222… concepteur, 3333…
-- formateur, 4444… responsable, 5555… apprenant.

reset role;
-- Une copie de l'apprenant en attente, et sa revue IA (posées hors RLS,
-- comme le fait l'application via le client d'administration).
insert into public.attempts (id, activity_id, user_id, answers, score, feedback, status, submitted_at)
values ('dddddddd-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000005',
        '55555555-5555-5555-5555-555555555555', '{}'::jsonb, null, '{"details": []}'::jsonb, 'pending_review', now())
on conflict (id) do nothing;
insert into public.attempt_ai_reviews (id, attempt_id, model_name, prompt_version, proposal)
values ('dddddddd-0000-0000-0000-000000000002', 'dddddddd-0000-0000-0000-000000000001',
        'deepseek-flash', 'precorrection-reponse/v1', '{"q": {"verdict": "acquise"}}'::jsonb)
on conflict (id) do nothing;

set role authenticated;

-- 1. L'apprenant ne lit pas la proposition sur sa propre copie.
select public.essai('55555555-5555-5555-5555-555555555555',
  $$select proposal from public.attempt_ai_reviews where attempt_id = 'dddddddd-0000-0000-0000-000000000001'$$,
  'apprenant lit sa revue IA (attendu : refusé 0 ligne)');

-- 2. Le formateur de l'organisation la lit.
select public.essai('33333333-3333-3333-3333-333333333333',
  $$select proposal from public.attempt_ai_reviews where attempt_id = 'dddddddd-0000-0000-0000-000000000001'$$,
  'formateur lit la revue IA (attendu : AUTORISÉ)');

-- 3. Le concepteur aussi (il encadre la formation).
select public.essai('22222222-2222-2222-2222-222222222222',
  $$select proposal from public.attempt_ai_reviews where attempt_id = 'dddddddd-0000-0000-0000-000000000001'$$,
  'concepteur lit la revue IA (attendu : AUTORISÉ)');

-- 4. Personne n'écrit par appel direct : ni l'apprenant, ni le formateur.
select public.essai('55555555-5555-5555-5555-555555555555',
  $$insert into public.attempt_ai_reviews (attempt_id, model_name, prompt_version, proposal)
    values ('dddddddd-0000-0000-0000-000000000001', 'x', 'x', '{}'::jsonb)$$,
  'apprenant insère une revue (attendu : refusé)');
select public.essai('33333333-3333-3333-3333-333333333333',
  $$update public.attempt_ai_reviews set validated_as_is = true where id = 'dddddddd-0000-0000-0000-000000000002'$$,
  'formateur modifie la revue par appel direct (attendu : refusé 0 ligne)');
select public.essai('33333333-3333-3333-3333-333333333333',
  $$delete from public.attempt_ai_reviews where id = 'dddddddd-0000-0000-0000-000000000002'$$,
  'formateur supprime la revue (attendu : refusé 0 ligne)');

-- 5. La trace ai_generations d'une pré-correction ne porte pas la
--    proposition : seulement la référence de la revue.
reset role;
insert into public.ai_generations (id, organization_id, requested_by, generation_type, prompt_version, model_name, status, result)
values ('dddddddd-0000-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-000000000001',
        '55555555-5555-5555-5555-555555555555', 'answer_precorrection', 'precorrection-reponse/v1', 'deepseek-flash',
        'succeeded', '{"review_id": "dddddddd-0000-0000-0000-000000000002"}'::jsonb)
on conflict (id) do nothing;
set role authenticated;
select public.essai('55555555-5555-5555-5555-555555555555',
  $$select result from public.ai_generations where id = 'dddddddd-0000-0000-0000-000000000003' and result ? 'verdict'$$,
  'apprenant trouve un verdict dans sa trace ai_generations (attendu : refusé 0 ligne)');

reset role;

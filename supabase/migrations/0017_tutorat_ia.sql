-- ============================================================
-- Elite Academy – Migration 0017
-- Tutorat IA adaptatif : demandes d'aide (reformulation, indice,
-- exemple, explication), score de blocage par compétence, exercices
-- personnalisés générés par l'IA, recommandations.
-- Références : addendum Tutorat IA §3 à §10 ; manuel §3.6, §9.
-- Dépend de 0004 (ai_generations), 0005 (activités, tentatives),
-- 0012 (notifications), 0013 (XP, badges).
--
-- Pourquoi une seule table d'événements d'aide : `attempts` est
-- immuable (aucune mise à jour possible), le compteur d'aides ne peut
-- donc pas y vivre ; et une « reformulation » est un événement d'aide
-- comme les autres. `reformulation_history` et `ai_tutor_sessions` des
-- documents fusionnent ici dans `tutor_help_events`.
-- ============================================================

-- ------------------------------------------------------------
-- 1. tutor_help_events – une ligne par bouton d'aide utilisé
-- ------------------------------------------------------------

create table public.tutor_help_events (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.profiles (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  course_id       uuid not null references public.courses (id) on delete cascade,
  activity_id     uuid not null references public.activities (id) on delete cascade,
  question_id     uuid references public.questions (id) on delete set null,
  competency_id   uuid references public.competencies (id) on delete set null,
  help_type       text not null check (help_type in (
                    'reformulate','dont_understand','hint','example','detailed_explanation'
                  )),
  generation_id   uuid references public.ai_generations (id) on delete set null,
  response_text   text,
  created_at      timestamptz not null default now()
);

create index idx_the_user_comp on public.tutor_help_events (user_id, course_id, competency_id, created_at desc);
create index idx_the_user_date on public.tutor_help_events (user_id, created_at desc);

-- ------------------------------------------------------------
-- 2. personalized_exercises – exercices générés, SANS la solution
-- ------------------------------------------------------------

create table public.personalized_exercises (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.profiles (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  course_id       uuid not null references public.courses (id) on delete cascade,
  competency_id   uuid not null references public.competencies (id) on delete cascade,
  exercise_type   text not null check (exercise_type in ('base','remediation','consolidation','challenge','quick_qcm')),
  difficulty      integer not null default 2 check (difficulty between 1 and 5),
  blocking_types  text[] not null default '{}',
  -- { title, instructions, questions: [{ prompt, options }] } — jamais la bonne réponse.
  content         jsonb not null,
  generation_id   uuid references public.ai_generations (id) on delete set null,
  status          text not null default 'pending' check (status in ('pending','completed')),
  answers         jsonb,
  score           numeric,
  feedback        jsonb,
  completed_at    timestamptz,
  created_at      timestamptz not null default now()
);

create index idx_pe_user on public.personalized_exercises (user_id, course_id, status, created_at desc);

-- ------------------------------------------------------------
-- 3. personalized_exercise_solutions – la solution, jamais servie
--    par l'API : RLS activée SANS politique (interdit à tous les rôles
--    applicatifs). Lue uniquement par le client d'administration lors
--    de la correction.
-- ------------------------------------------------------------

create table public.personalized_exercise_solutions (
  exercise_id uuid primary key references public.personalized_exercises (id) on delete cascade,
  -- { answers: [{ correct_index, explanation }] }
  solution    jsonb not null
);

-- ------------------------------------------------------------
-- 4. competency_blocking_scores – score de blocage par compétence
-- ------------------------------------------------------------

create table public.competency_blocking_scores (
  user_id             uuid not null references public.profiles (id) on delete cascade,
  course_id           uuid not null references public.courses (id) on delete cascade,
  competency_id       uuid not null references public.competencies (id) on delete cascade,
  score               numeric(3,2),
  band                text check (band in ('aucun','leger','modere','important','critique')),
  blocking_types      text[] not null default '{}',
  nb_aides            integer not null default 0,
  nb_reformulations   integer not null default 0,
  nb_echecs           integer not null default 0,
  nb_tentatives       integer not null default 0,
  nb_exercices_perso  integer not null default 0,
  history             jsonb not null default '[]'::jsonb,   -- derniers scores, pour la tendance
  computed_at         timestamptz not null default now(),
  alerted_at          timestamptz,
  primary key (user_id, course_id, competency_id)
);

create index idx_cbs_course_score on public.competency_blocking_scores (course_id, score desc);

-- ------------------------------------------------------------
-- 5. personalized_recommendations
-- ------------------------------------------------------------

create table public.personalized_recommendations (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references public.profiles (id) on delete cascade,
  organization_id     uuid not null references public.organizations (id) on delete cascade,
  course_id           uuid not null references public.courses (id) on delete cascade,
  competency_id       uuid references public.competencies (id) on delete cascade,
  recommendation_type text not null check (recommendation_type in ('exercise','review','trainer_meeting','peer_help','situation')),
  data                jsonb not null default '{}'::jsonb,
  priority            integer not null default 5,
  is_completed        boolean not null default false,
  completed_at        timestamptz,
  created_at          timestamptz not null default now()
);

create index idx_pr_user on public.personalized_recommendations (user_id, course_id, is_completed, priority);

-- ------------------------------------------------------------
-- 6. Row Level Security
-- ------------------------------------------------------------

alter table public.tutor_help_events               enable row level security;
alter table public.personalized_exercises          enable row level security;
alter table public.personalized_exercise_solutions enable row level security;
alter table public.competency_blocking_scores      enable row level security;
alter table public.personalized_recommendations    enable row level security;

-- Lecture : l'apprenant concerné et l'encadrement de la formation.
-- Toute écriture passe par le client d'administration (moteur).
create policy tutor_help_events_select on public.tutor_help_events
  for select using (user_id = auth.uid() or public.oversees_course(course_id));

create policy personalized_exercises_select on public.personalized_exercises
  for select using (user_id = auth.uid() or public.oversees_course(course_id));

-- personalized_exercise_solutions : AUCUNE politique → deny-all.

create policy competency_blocking_scores_select on public.competency_blocking_scores
  for select using (user_id = auth.uid() or public.oversees_course(course_id));

create policy personalized_recommendations_select on public.personalized_recommendations
  for select using (user_id = auth.uid() or public.oversees_course(course_id));

create policy personalized_recommendations_update on public.personalized_recommendations
  for update using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Générations IA : tout membre peut demander une aide ou des exercices
-- pour lui-même (types 'tutor_help' et 'tutor_exercises').
drop policy if exists ai_gen_insert on public.ai_generations;
create policy ai_gen_insert on public.ai_generations
  for insert with check (
    requested_by = auth.uid()
    and (
      public.is_elite_admin()
      or (
        generation_type in ('course_plan', 'document_structuring')
        and public.has_org_role(organization_id, array['admin','designer']::public.member_role[])
      )
      or (
        generation_type = 'session_analysis'
        and public.has_org_role(organization_id, array['admin','designer','trainer','manager']::public.member_role[])
      )
      or (
        generation_type in ('tutor_help', 'tutor_exercises')
        and public.is_org_member(organization_id)
      )
    )
  );

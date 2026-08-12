-- ============================================================
-- Elite Academy – Migration 0005
-- Parcours apprenant : inscriptions, activités, QCM,
-- tentatives et progression par compétence.
-- Référence : schéma Supabase §4-§5, PRD §9-§11, §14.
--
-- Rappel de conception (leçon 0003) : chaque politique SELECT
-- d'une table où l'application fait INSERT ... RETURNING contient
-- une condition directe sur la ligne (user_id = auth.uid()).
-- ============================================================

-- ------------------------------------------------------------
-- 0. Types
-- ------------------------------------------------------------

create type public.activity_type as enum (
  'video', 'audio', 'pdf', 'text', 'quiz', 'open_question',
  'exercise', 'case_study', 'simulation', 'project', 'live'
);

create type public.enrollment_status as enum (
  'active', 'completed', 'withdrawn', 'suspended'
);

create type public.attempt_status as enum (
  'in_progress', 'submitted', 'graded'
);

-- ------------------------------------------------------------
-- 1. enrollments – inscriptions aux formations
-- ------------------------------------------------------------

create table public.enrollments (
  id              uuid primary key default gen_random_uuid(),
  course_id       uuid not null references public.courses (id) on delete cascade,
  user_id         uuid not null references public.profiles (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  assigned_by     uuid references public.profiles (id),
  status          public.enrollment_status not null default 'active',
  started_at      timestamptz,
  completed_at    timestamptz,
  created_at      timestamptz not null default now(),
  unique (course_id, user_id)
);

create index idx_enroll_user on public.enrollments (user_id);
create index idx_enroll_course on public.enrollments (course_id);
create index idx_enroll_org on public.enrollments (organization_id);

-- ------------------------------------------------------------
-- 2. activities – activités rattachées aux leçons
-- ------------------------------------------------------------

create table public.activities (
  id              uuid primary key default gen_random_uuid(),
  lesson_id       uuid not null references public.lessons (id) on delete cascade,
  type            public.activity_type not null default 'quiz',
  title           text not null,
  instructions    text,
  content         jsonb not null default '{}'::jsonb,
  difficulty      integer not null default 1 check (difficulty between 1 and 5),
  position        integer not null default 0,
  generated_by_ai boolean not null default false,
  status          public.course_status not null default 'draft',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create trigger trg_activities_updated
  before update on public.activities
  for each row execute function public.set_updated_at();

create index idx_activities_lesson on public.activities (lesson_id, position);

create table public.activity_competencies (
  activity_id   uuid not null references public.activities (id) on delete cascade,
  competency_id uuid not null references public.competencies (id) on delete cascade,
  level         public.mastery_level not null default 'fundamentals',
  weight        integer not null default 1,
  primary key (activity_id, competency_id)
);

-- ------------------------------------------------------------
-- 3. questions – questions d'une activité (QCM en priorité)
-- ------------------------------------------------------------

create table public.questions (
  id              uuid primary key default gen_random_uuid(),
  activity_id     uuid not null references public.activities (id) on delete cascade,
  type            text not null default 'qcm',
  prompt          text not null,
  options         jsonb not null default '[]'::jsonb,
  expected_answer jsonb not null default '{}'::jsonb,
  explanation     text,
  difficulty      integer not null default 1 check (difficulty between 1 and 5),
  competency_id   uuid references public.competencies (id) on delete set null,
  position        integer not null default 0,
  created_at      timestamptz not null default now()
);

create index idx_questions_activity on public.questions (activity_id, position);

-- ------------------------------------------------------------
-- 4. attempts – tentatives des apprenants
-- ------------------------------------------------------------

create table public.attempts (
  id           uuid primary key default gen_random_uuid(),
  activity_id  uuid not null references public.activities (id) on delete cascade,
  user_id      uuid not null references public.profiles (id) on delete cascade,
  session_id   uuid,
  answers      jsonb not null default '{}'::jsonb,
  score        numeric,
  feedback     jsonb not null default '{}'::jsonb,
  status       public.attempt_status not null default 'submitted',
  started_at   timestamptz not null default now(),
  submitted_at timestamptz
);

create index idx_attempts_user on public.attempts (user_id, activity_id);
create index idx_attempts_activity on public.attempts (activity_id);

-- ------------------------------------------------------------
-- 5. progress_records – progression (leçons et compétences)
-- ------------------------------------------------------------

create table public.progress_records (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references public.profiles (id) on delete cascade,
  course_id          uuid not null references public.courses (id) on delete cascade,
  module_id          uuid references public.modules (id) on delete cascade,
  lesson_id          uuid references public.lessons (id) on delete cascade,
  activity_id        uuid references public.activities (id) on delete cascade,
  competency_id      uuid references public.competencies (id) on delete cascade,
  completion_percent numeric,
  mastery_level      public.mastery_level,
  score              numeric,
  evidence           jsonb not null default '{}'::jsonb,
  updated_at         timestamptz not null default now()
);

-- Une seule ligne « leçon terminée » par utilisateur et leçon,
-- une seule ligne de maîtrise par utilisateur, formation et compétence.
create unique index uq_progress_lesson
  on public.progress_records (user_id, lesson_id)
  where lesson_id is not null;

create unique index uq_progress_competency
  on public.progress_records (user_id, course_id, competency_id)
  where competency_id is not null;

create index idx_progress_user_course on public.progress_records (user_id, course_id);

-- ------------------------------------------------------------
-- 6. Fonction d'aide : rôle pédagogique sur la formation
--    (formateur/responsable/admin de l'organisation de la
--    formation, ou admin Elite Experience)
-- ------------------------------------------------------------

create or replace function public.oversees_course(cid uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.courses c
    where c.id = cid
      and (
        public.is_elite_admin()
        or public.has_org_role(
             c.organization_id,
             array['admin','designer','trainer','manager']::public.member_role[]
           )
      )
  );
$$;

-- Idem à partir d'une activité.
create or replace function public.oversees_activity(aid uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.activities a
    join public.lessons l on l.id = a.lesson_id
    join public.modules m on m.id = l.module_id
    join public.course_versions v on v.id = m.course_version_id
    where a.id = aid
      and public.oversees_course(v.course_id)
  );
$$;

-- L'activité appartient-elle à une formation consultable ?
create or replace function public.can_view_activity(aid uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.activities a
    join public.lessons l on l.id = a.lesson_id
    join public.modules m on m.id = l.module_id
    join public.course_versions v on v.id = m.course_version_id
    where a.id = aid
      and public.can_view_course(v.course_id)
  );
$$;

-- L'activité est-elle modifiable ?
create or replace function public.can_edit_activity(aid uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.activities a
    join public.lessons l on l.id = a.lesson_id
    join public.modules m on m.id = l.module_id
    join public.course_versions v on v.id = m.course_version_id
    where a.id = aid
      and public.can_edit_course(v.course_id)
  );
$$;

-- ------------------------------------------------------------
-- 7. Row Level Security
-- ------------------------------------------------------------

alter table public.enrollments           enable row level security;
alter table public.activities            enable row level security;
alter table public.activity_competencies enable row level security;
alter table public.questions             enable row level security;
alter table public.attempts              enable row level security;
alter table public.progress_records      enable row level security;

-- ----- enrollments -----

-- Lecture : l'apprenant lui-même (condition directe), l'encadrement
-- de l'organisation de la formation, Elite Experience.
create policy enrollments_select on public.enrollments
  for select using (
    user_id = auth.uid()
    or public.is_elite_admin()
    or public.has_org_role(
         organization_id,
         array['admin','designer','trainer','manager']::public.member_role[]
       )
  );

-- Inscription : soi-même à une formation consultable (donc publiée
-- pour un apprenant, via can_view_course), ou attribution par un
-- admin/responsable de l'organisation.
create policy enrollments_insert on public.enrollments
  for insert with check (
    (user_id = auth.uid() and public.can_view_course(course_id))
    or public.is_elite_admin()
    or public.has_org_role(
         organization_id,
         array['admin','manager']::public.member_role[]
       )
  );

-- Mise à jour (statut, dates) : l'apprenant lui-même ou l'encadrement.
create policy enrollments_update on public.enrollments
  for update using (
    user_id = auth.uid()
    or public.is_elite_admin()
    or public.has_org_role(
         organization_id,
         array['admin','manager']::public.member_role[]
       )
  );

-- ----- activities -----

create policy activities_select on public.activities
  for select using (can_view_activity(id));

create policy activities_write on public.activities
  for all using (
    exists (
      select 1
      from public.lessons l
      join public.modules m on m.id = l.module_id
      join public.course_versions v on v.id = m.course_version_id
      where l.id = lesson_id
        and public.can_edit_course(v.course_id)
    )
  ) with check (
    exists (
      select 1
      from public.lessons l
      join public.modules m on m.id = l.module_id
      join public.course_versions v on v.id = m.course_version_id
      where l.id = lesson_id
        and public.can_edit_course(v.course_id)
    )
  );

-- ----- activity_competencies -----

create policy act_comp_select on public.activity_competencies
  for select using (public.can_view_activity(activity_id));

create policy act_comp_write on public.activity_competencies
  for all using (public.can_edit_activity(activity_id))
  with check (public.can_edit_activity(activity_id));

-- ----- questions -----
-- Lecture par les personnes ayant accès à la formation : nécessaire
-- pour passer le QCM. L'application ne transmet jamais expected_answer
-- au navigateur avant soumission (correction côté serveur).

create policy questions_select on public.questions
  for select using (public.can_view_activity(activity_id));

create policy questions_write on public.questions
  for all using (public.can_edit_activity(activity_id))
  with check (public.can_edit_activity(activity_id));

-- ----- attempts -----

create policy attempts_select on public.attempts
  for select using (
    user_id = auth.uid()
    or public.oversees_activity(activity_id)
  );

create policy attempts_insert on public.attempts
  for insert with check (
    user_id = auth.uid()
    and public.can_view_activity(activity_id)
  );

-- Pas de modification ni suppression : chaque tentative est une preuve.

-- ----- progress_records -----

create policy progress_select on public.progress_records
  for select using (
    user_id = auth.uid()
    or public.oversees_course(course_id)
  );

create policy progress_insert on public.progress_records
  for insert with check (user_id = auth.uid());

create policy progress_update on public.progress_records
  for update using (user_id = auth.uid());

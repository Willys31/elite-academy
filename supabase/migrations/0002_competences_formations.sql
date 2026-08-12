-- ============================================================
-- Elite Academy – Migration 0002
-- Référentiel de compétences, formations, versions,
-- modules et leçons, avec cycle de statuts et RLS.
-- Référence : elite_academy_schema_supabase_final.md (§3),
-- PRD (§6, §8), architecture (§9).
-- ============================================================

-- ------------------------------------------------------------
-- 0. Types énumérés
-- ------------------------------------------------------------

create type public.course_status as enum (
  'draft',      -- brouillon
  'review',     -- en attente de validation
  'approved',   -- validé
  'published',  -- publié
  'archived'    -- archivé
);

create type public.mastery_level as enum (
  'fundamentals',  -- Fondamentaux
  'operational',   -- Opérationnel
  'advanced',      -- Avancé
  'elite'          -- Elite
);

create type public.course_context as enum (
  'generic',
  'sector',
  'organization',
  'brand',
  'confidential'
);

create type public.course_format as enum (
  'online',
  'in_person',
  'hybrid'
);

-- ------------------------------------------------------------
-- 1. competencies – référentiel de compétences
--    organization_id NULL = compétence globale (Elite Experience)
-- ------------------------------------------------------------

create table public.competencies (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid references public.organizations (id) on delete cascade,
  name                text not null,
  description         text,
  domain              text,
  observable_criteria jsonb not null default '[]'::jsonb,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create trigger trg_competencies_updated
  before update on public.competencies
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------
-- 2. courses – formations
-- ------------------------------------------------------------

create table public.courses (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references public.organizations (id) on delete cascade,
  owner_id           uuid not null references public.profiles (id),
  brand_id           uuid references public.brands (id) on delete set null,
  title              text not null,
  slug               text not null,
  description        text,
  context_type       public.course_context not null default 'generic',
  sector             text,
  target_audience    text,
  prerequisites      text,
  duration_minutes   integer,
  format             public.course_format not null default 'online',
  status             public.course_status not null default 'draft',
  current_version_id uuid,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (organization_id, slug)
);

create trigger trg_courses_updated
  before update on public.courses
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------
-- 3. course_versions – versions d'une formation
-- ------------------------------------------------------------

create table public.course_versions (
  id             uuid primary key default gen_random_uuid(),
  course_id      uuid not null references public.courses (id) on delete cascade,
  version_number integer not null,
  change_summary text,
  created_by     uuid not null references public.profiles (id),
  approved_by    uuid references public.profiles (id),
  approved_at    timestamptz,
  published_at   timestamptz,
  status         public.course_status not null default 'draft',
  created_at     timestamptz not null default now(),
  unique (course_id, version_number)
);

alter table public.courses
  add constraint courses_current_version_fk
  foreign key (current_version_id)
  references public.course_versions (id)
  on delete set null;

-- ------------------------------------------------------------
-- 4. course_competencies – compétences visées par une formation
-- ------------------------------------------------------------

create table public.course_competencies (
  course_id               uuid not null references public.courses (id) on delete cascade,
  competency_id           uuid not null references public.competencies (id) on delete cascade,
  target_level            public.mastery_level not null default 'fundamentals',
  weight                  integer not null default 1,
  required_for_completion boolean not null default true,
  created_at              timestamptz not null default now(),
  primary key (course_id, competency_id)
);

-- ------------------------------------------------------------
-- 5. modules et lessons
-- ------------------------------------------------------------

create table public.modules (
  id                uuid primary key default gen_random_uuid(),
  course_version_id uuid not null references public.course_versions (id) on delete cascade,
  title             text not null,
  description       text,
  position          integer not null default 0,
  objectives        jsonb not null default '[]'::jsonb,
  status            public.course_status not null default 'draft',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create trigger trg_modules_updated
  before update on public.modules
  for each row execute function public.set_updated_at();

create table public.lessons (
  id                uuid primary key default gen_random_uuid(),
  module_id         uuid not null references public.modules (id) on delete cascade,
  title             text not null,
  content           jsonb not null default '{}'::jsonb,
  position          integer not null default 0,
  estimated_minutes integer,
  status            public.course_status not null default 'draft',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create trigger trg_lessons_updated
  before update on public.lessons
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------
-- 6. Index
-- ------------------------------------------------------------

create index idx_competencies_org on public.competencies (organization_id);
create index idx_courses_org      on public.courses (organization_id);
create index idx_courses_status   on public.courses (status);
create index idx_versions_course  on public.course_versions (course_id);
create index idx_modules_version  on public.modules (course_version_id, position);
create index idx_lessons_module   on public.lessons (module_id, position);
create index idx_course_comp_comp on public.course_competencies (competency_id);

-- ------------------------------------------------------------
-- 7. Fonctions d'aide (SECURITY DEFINER, évitent la récursivité RLS)
-- ------------------------------------------------------------

-- Peut modifier la formation : admin Elite Experience,
-- admin/concepteur de l'organisation, ou propriétaire.
create or replace function public.can_edit_course(cid uuid)
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
        or c.owner_id = auth.uid()
        or public.has_org_role(
             c.organization_id,
             array['admin','designer']::public.member_role[]
           )
      )
  );
$$;

-- Peut consulter la formation :
-- - qui peut la modifier ;
-- - formateur/responsable de l'organisation (tous statuts, lecture) ;
-- - membre de l'organisation si elle est publiée ;
-- - tout utilisateur connecté si elle est publiée, générique
--   et portée par l'organisation Elite Experience.
create or replace function public.can_view_course(cid uuid)
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
        public.can_edit_course(cid)
        or public.has_org_role(
             c.organization_id,
             array['trainer','manager']::public.member_role[]
           )
        or (c.status = 'published' and public.is_org_member(c.organization_id))
        or (
          c.status = 'published'
          and c.context_type = 'generic'
          and exists (
            select 1 from public.organizations o
            where o.id = c.organization_id
              and o.type = 'elite_experience'
          )
          and auth.uid() is not null
        )
      )
  );
$$;

-- ------------------------------------------------------------
-- 8. Row Level Security
-- ------------------------------------------------------------

alter table public.competencies        enable row level security;
alter table public.courses             enable row level security;
alter table public.course_versions     enable row level security;
alter table public.course_competencies enable row level security;
alter table public.modules             enable row level security;
alter table public.lessons             enable row level security;

-- ----- competencies -----

-- Lecture : compétences globales pour tout utilisateur connecté,
-- compétences d'organisation pour ses membres et Elite Experience.
create policy competencies_select on public.competencies
  for select using (
    (organization_id is null and auth.uid() is not null)
    or public.is_org_member(organization_id)
    or public.is_elite_admin()
  );

-- Écriture : Elite Experience pour les globales,
-- admin/concepteur de l'organisation pour les autres.
create policy competencies_insert on public.competencies
  for insert with check (
    (organization_id is null and public.is_elite_admin())
    or public.is_elite_admin()
    or public.has_org_role(organization_id, array['admin','designer']::public.member_role[])
  );

create policy competencies_update on public.competencies
  for update using (
    (organization_id is null and public.is_elite_admin())
    or (organization_id is not null and (
      public.is_elite_admin()
      or public.has_org_role(organization_id, array['admin','designer']::public.member_role[])
    ))
  );

create policy competencies_delete on public.competencies
  for delete using (
    (organization_id is null and public.is_elite_admin())
    or (organization_id is not null and (
      public.is_elite_admin()
      or public.has_org_role(organization_id, array['admin']::public.member_role[])
    ))
  );

-- ----- courses -----

create policy courses_select on public.courses
  for select using (public.can_view_course(id));

create policy courses_insert on public.courses
  for insert with check (
    owner_id = auth.uid()
    and (
      public.is_elite_admin()
      or public.has_org_role(organization_id, array['admin','designer']::public.member_role[])
    )
  );

create policy courses_update on public.courses
  for update using (public.can_edit_course(id));

create policy courses_delete on public.courses
  for delete using (
    public.is_elite_admin()
    or public.has_org_role(organization_id, array['admin']::public.member_role[])
  );

-- ----- course_versions -----

create policy versions_select on public.course_versions
  for select using (public.can_view_course(course_id));

create policy versions_insert on public.course_versions
  for insert with check (public.can_edit_course(course_id));

create policy versions_update on public.course_versions
  for update using (public.can_edit_course(course_id));

create policy versions_delete on public.course_versions
  for delete using (public.can_edit_course(course_id));

-- ----- course_competencies -----

create policy course_comp_select on public.course_competencies
  for select using (public.can_view_course(course_id));

create policy course_comp_insert on public.course_competencies
  for insert with check (public.can_edit_course(course_id));

create policy course_comp_update on public.course_competencies
  for update using (public.can_edit_course(course_id));

create policy course_comp_delete on public.course_competencies
  for delete using (public.can_edit_course(course_id));

-- ----- modules -----

create policy modules_select on public.modules
  for select using (
    exists (
      select 1 from public.course_versions v
      where v.id = course_version_id
        and public.can_view_course(v.course_id)
    )
  );

create policy modules_write on public.modules
  for all using (
    exists (
      select 1 from public.course_versions v
      where v.id = course_version_id
        and public.can_edit_course(v.course_id)
    )
  ) with check (
    exists (
      select 1 from public.course_versions v
      where v.id = course_version_id
        and public.can_edit_course(v.course_id)
    )
  );

-- ----- lessons -----

create policy lessons_select on public.lessons
  for select using (
    exists (
      select 1
      from public.modules m
      join public.course_versions v on v.id = m.course_version_id
      where m.id = module_id
        and public.can_view_course(v.course_id)
    )
  );

create policy lessons_write on public.lessons
  for all using (
    exists (
      select 1
      from public.modules m
      join public.course_versions v on v.id = m.course_version_id
      where m.id = module_id
        and public.can_edit_course(v.course_id)
    )
  ) with check (
    exists (
      select 1
      from public.modules m
      join public.course_versions v on v.id = m.course_version_id
      where m.id = module_id
        and public.can_edit_course(v.course_id)
    )
  );
